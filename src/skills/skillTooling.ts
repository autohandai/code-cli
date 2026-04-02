/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared skill tooling helpers for tool calls and CLI bootstrap flows.
 */
import { ProjectAnalyzer, type ProjectAnalysis } from './autoSkill.js';
import { LearnAdvisor } from './LearnAdvisor.js';
import { CommunitySkillsCache } from './CommunitySkillsCache.js';
import { GitHubRegistryFetcher } from './GitHubRegistryFetcher.js';
import {
  fetchRegistryWithFallback,
  installSkillWithSecurity,
  type InstallContext,
} from './communityInstaller.js';
import type { LLMProvider } from '../providers/LLMProvider.js';
import type { SkillsRegistry } from './SkillsRegistry.js';
import type {
  CommunitySkillsRegistry,
  GitHubCommunitySkill,
  LearnAnalysisResponse,
  LearnRecommendation,
  SkillInstallScope,
} from '../types.js';

interface SkillRegistryLike {
  listSkills(): Array<{
    name: string;
    isActive?: boolean;
    metadata?: Record<string, string>;
  }>;
  activateSkill(name: string): boolean;
}

interface RegistryFetcherLike {
  findSkill(skills: GitHubCommunitySkill[], nameOrId: string): GitHubCommunitySkill | null;
  fetchSkillDirectory?(skill: GitHubCommunitySkill): Promise<Map<string, string>>;
  findSimilarSkills?(skills: GitHubCommunitySkill[], query: string, limit?: number): GitHubCommunitySkill[];
}

interface RegistryCacheLike {
  getRegistry?: () => Promise<CommunitySkillsRegistry | null>;
  getRegistryIgnoreTTL?: () => Promise<CommunitySkillsRegistry | null>;
  setRegistry?: (registry: CommunitySkillsRegistry) => Promise<void>;
  getSkillDirectory?: (skillId: string) => Promise<Map<string, string> | null>;
  setSkillDirectory?: (skillId: string, files: Map<string, string>) => Promise<void>;
}

interface ProjectAnalyzerLike {
  analyze(): Promise<ProjectAnalysis>;
}

interface LearnAdvisorLike {
  analyze(
    analysis: ProjectAnalysis,
    installedSkills: ReturnType<SkillsRegistry['listSkills']>,
    registrySkills: GitHubCommunitySkill[],
  ): Promise<LearnAnalysisResponse>;
}

export interface SkillToolingDependencies {
  analyzer?: ProjectAnalyzerLike;
  advisor?: LearnAdvisorLike;
  cache?: RegistryCacheLike;
  fetcher?: RegistryFetcherLike;
  fetchRegistry?: (
    cache: RegistryCacheLike,
    fetcher: RegistryFetcherLike,
  ) => Promise<CommunitySkillsRegistry | null>;
  installSkill?: (
    ctx: InstallContext,
    skill: GitHubCommunitySkill,
    cache: RegistryCacheLike,
    fetcher: RegistryFetcherLike,
    scope?: SkillInstallScope,
  ) => Promise<string>;
}

export interface InstallAgentSkillOptions {
  scope?: SkillInstallScope;
  activate?: boolean;
}

export interface InstallAgentSkillResult {
  message: string;
  communitySkill?: GitHubCommunitySkill | null;
  installedSkillName?: string | null;
  activated: boolean;
}

export interface BootstrapProjectSkillsContext extends InstallContext {
  llm: LLMProvider;
  skillsRegistry: SkillsRegistry;
}

export interface BootstrapProjectSkillsOptions {
  maxRecommendations?: number;
  minScore?: number;
  scope?: SkillInstallScope;
  activate?: boolean;
}

export interface BootstrapProjectSkillsResult {
  analysis: ProjectAnalysis;
  projectSummary: string;
  recommendations: LearnRecommendation[];
  selectedSkills: GitHubCommunitySkill[];
  installMessages: string[];
  installedSkillNames: string[];
  activatedSkillNames: string[];
}

function getDependencies(
  workspaceRoot: string,
  llm: LLMProvider | undefined,
  overrides: SkillToolingDependencies = {},
): Required<SkillToolingDependencies> {
  return {
    analyzer: overrides.analyzer ?? new ProjectAnalyzer(workspaceRoot),
    advisor: overrides.advisor ?? (
      llm
        ? new LearnAdvisor(llm)
        : {
            analyze: async () => ({
              projectSummary: '',
              audit: [],
              recommendations: [],
              gapAnalysis: null,
            }),
          }
    ),
    cache: overrides.cache ?? new CommunitySkillsCache(),
    fetcher: overrides.fetcher ?? new GitHubRegistryFetcher(),
    fetchRegistry: overrides.fetchRegistry ?? ((cache, fetcher) =>
      fetchRegistryWithFallback(cache as CommunitySkillsCache, fetcher as GitHubRegistryFetcher)),
    installSkill: overrides.installSkill ?? ((ctx, skill, cache, fetcher, scope) =>
      installSkillWithSecurity(
        ctx,
        skill,
        cache as CommunitySkillsCache,
        fetcher as GitHubRegistryFetcher,
        scope,
      )),
  };
}

export function resolveInstalledSkillName(
  skillsRegistry: SkillRegistryLike,
  skill: Pick<GitHubCommunitySkill, 'id' | 'name'>,
): string | null {
  const normalizedId = skill.id.toLowerCase();
  const normalizedName = skill.name.toLowerCase();

  for (const installedSkill of skillsRegistry.listSkills()) {
    const installedName = installedSkill.name.toLowerCase();
    const slug = installedSkill.metadata?.['agentskill-slug']?.toLowerCase();
    if (slug === normalizedId || installedName === normalizedId || installedName === normalizedName) {
      return installedSkill.name;
    }
  }

  return null;
}

function buildSkillNotFoundMessage(
  skillName: string,
  registry: CommunitySkillsRegistry,
  fetcher: RegistryFetcherLike,
): string {
  const lines = [`Skill not found in the community registry: ${skillName}`];
  const similar = fetcher.findSimilarSkills?.(registry.skills, skillName, 3) ?? [];
  if (similar.length > 0) {
    lines.push(`Did you mean: ${similar.map((skill) => skill.id).join(', ')}`);
  }
  return lines.join('\n');
}

export async function installAgentSkillByName(
  ctx: InstallContext & { skillsRegistry: SkillRegistryLike },
  skillName: string,
  options: InstallAgentSkillOptions = {},
  overrides: SkillToolingDependencies = {},
): Promise<InstallAgentSkillResult> {
  const trimmedName = skillName.trim();
  if (!trimmedName) {
    return {
      message: 'Skill name is required.',
      communitySkill: null,
      installedSkillName: null,
      activated: false,
    };
  }

  const { cache, fetcher, fetchRegistry, installSkill } = getDependencies(
    ctx.workspaceRoot,
    undefined,
    overrides,
  );
  const registry = await fetchRegistry(cache, fetcher);

  if (!registry || registry.skills.length === 0) {
    return {
      message: 'Community skills registry unavailable.',
      communitySkill: null,
      installedSkillName: null,
      activated: false,
    };
  }

  const communitySkill = fetcher.findSkill(registry.skills, trimmedName);
  if (!communitySkill) {
    return {
      message: buildSkillNotFoundMessage(trimmedName, registry, fetcher),
      communitySkill: null,
      installedSkillName: null,
      activated: false,
    };
  }

  const installMessage = await installSkill(
    ctx,
    communitySkill,
    cache,
    fetcher,
    options.scope ?? 'project',
  );

  const installedSkillName = resolveInstalledSkillName(ctx.skillsRegistry, communitySkill);
  let activated = false;

  if (options.activate !== false && installedSkillName) {
    activated = ctx.skillsRegistry.activateSkill(installedSkillName);
  }

  const message = activated
    ? `${installMessage}\nActivated skill: ${installedSkillName}`
    : installMessage;

  return {
    message,
    communitySkill,
    installedSkillName,
    activated,
  };
}

function selectRecommendedSkills(
  recommendations: LearnRecommendation[],
  registry: CommunitySkillsRegistry,
  fetcher: RegistryFetcherLike,
  minScore: number,
  maxRecommendations: number,
): { recommendations: LearnRecommendation[]; selectedSkills: GitHubCommunitySkill[] } {
  const chosenRecommendations: LearnRecommendation[] = [];
  const selectedSkills: GitHubCommunitySkill[] = [];
  const seen = new Set<string>();

  for (const recommendation of recommendations
    .filter((entry) => entry.score >= minScore)
    .sort((a, b) => b.score - a.score)) {
    const skill = fetcher.findSkill(registry.skills, recommendation.slug);
    if (!skill || seen.has(skill.id)) {
      continue;
    }
    seen.add(skill.id);
    chosenRecommendations.push(recommendation);
    selectedSkills.push(skill);
    if (selectedSkills.length >= maxRecommendations) {
      break;
    }
  }

  return { recommendations: chosenRecommendations, selectedSkills };
}

export async function bootstrapProjectSkills(
  ctx: BootstrapProjectSkillsContext,
  options: BootstrapProjectSkillsOptions = {},
  overrides: SkillToolingDependencies = {},
): Promise<BootstrapProjectSkillsResult> {
  const {
    analyzer,
    advisor,
    cache,
    fetcher,
    fetchRegistry,
    installSkill,
  } = getDependencies(ctx.workspaceRoot, ctx.llm, overrides);

  const analysis = await analyzer.analyze();
  const registry = await fetchRegistry(cache, fetcher);

  if (!registry || registry.skills.length === 0) {
    return {
      analysis,
      projectSummary: '',
      recommendations: [],
      selectedSkills: [],
      installMessages: ['Community skills registry unavailable.'],
      installedSkillNames: [],
      activatedSkillNames: [],
    };
  }

  const learnResult = await advisor.analyze(
    analysis,
    ctx.skillsRegistry.listSkills() as ReturnType<SkillsRegistry['listSkills']>,
    registry.skills,
  );

  const { recommendations, selectedSkills } = selectRecommendedSkills(
    learnResult.recommendations,
    registry,
    fetcher,
    options.minScore ?? 80,
    options.maxRecommendations ?? 3,
  );

  const installedSkillNames: string[] = [];
  const activatedSkillNames: string[] = [];
  const installMessages: string[] = [];

  for (const skill of selectedSkills) {
    const existingNames = new Set(ctx.skillsRegistry.listSkills().map((entry) => entry.name));
    const installMessage = await installSkill(
      ctx,
      skill,
      cache,
      fetcher,
      options.scope ?? 'project',
    );
    installMessages.push(installMessage);

    const resolvedName = resolveInstalledSkillName(ctx.skillsRegistry, skill);
    if (!resolvedName) {
      continue;
    }

    if (!existingNames.has(resolvedName)) {
      installedSkillNames.push(resolvedName);
    }

    if (options.activate !== false && ctx.skillsRegistry.activateSkill(resolvedName)) {
      activatedSkillNames.push(resolvedName);
    }
  }

  return {
    analysis,
    projectSummary: learnResult.projectSummary,
    recommendations,
    selectedSkills,
    installMessages,
    installedSkillNames,
    activatedSkillNames,
  };
}
