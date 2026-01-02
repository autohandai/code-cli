/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * SkillsBrowserUI - Main Ink-based browser for community skills marketplace
 */
import React, { useState, useMemo, useCallback } from 'react';
import { Box, Text, useInput, render } from 'ink';
import type {
  CommunitySkillsRegistry,
  GitHubCommunitySkill,
  SkillInstallScope,
  SkillsBrowserTab,
} from '../../types.js';

// ============ Types ============

export interface SkillsBrowserOptions {
  registry: CommunitySkillsRegistry;
  onInstall: (skill: GitHubCommunitySkill, scope: SkillInstallScope) => Promise<void>;
}

export interface SkillsBrowserResult {
  installed: boolean;
  skillName?: string;
  scope?: SkillInstallScope;
}

// ============ Main Entry Point ============

export async function showSkillsBrowser(
  options: SkillsBrowserOptions
): Promise<SkillsBrowserResult> {
  if (!process.stdout.isTTY) {
    return { installed: false };
  }

  return new Promise((resolve) => {
    let completed = false;

    const instance = render(
      <SkillsBrowser
        registry={options.registry}
        onInstall={options.onInstall}
        onExit={(result) => {
          if (completed) return;
          completed = true;
          instance.unmount();
          resolve(result);
        }}
      />,
      { exitOnCtrlC: false }
    );
  });
}

// ============ Main Component ============

interface SkillsBrowserProps {
  registry: CommunitySkillsRegistry;
  onInstall: (skill: GitHubCommunitySkill, scope: SkillInstallScope) => Promise<void>;
  onExit: (result: SkillsBrowserResult) => void;
}

function SkillsBrowser({ registry, onInstall, onExit }: SkillsBrowserProps) {
  const [activeTab, setActiveTab] = useState<SkillsBrowserTab>('featured');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [installScope, setInstallScope] = useState<SkillInstallScope>('user');
  const [isInstalling, setIsInstalling] = useState(false);

  // Filter skills based on active tab and search
  const filteredSkills = useMemo(() => {
    let skills = registry.skills;

    if (activeTab === 'featured') {
      skills = skills.filter((s) => s.isFeatured);
    } else if (activeTab === 'categories' && selectedCategory) {
      skills = skills.filter((s) => s.category === selectedCategory);
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      skills = skills.filter((s) => {
        const text = [s.name, s.description, ...(s.tags || [])].join(' ').toLowerCase();
        return text.includes(query);
      });
    }

    return skills;
  }, [registry.skills, activeTab, selectedCategory, searchQuery]);

  const selectedSkill = filteredSkills[selectedIndex] || null;

  // Handle installation
  const handleInstall = useCallback(async () => {
    if (!selectedSkill || isInstalling) return;

    setIsInstalling(true);
    try {
      await onInstall(selectedSkill, installScope);
      onExit({
        installed: true,
        skillName: selectedSkill.name,
        scope: installScope,
      });
    } catch {
      setIsInstalling(false);
      setShowInstallModal(false);
    }
  }, [selectedSkill, installScope, isInstalling, onInstall, onExit]);

  // Input handling
  useInput((input, key) => {
    if (isInstalling) return;

    // Install modal handling
    if (showInstallModal) {
      if (key.escape) {
        setShowInstallModal(false);
        return;
      }
      if (key.return) {
        handleInstall();
        return;
      }
      if (key.upArrow || key.downArrow) {
        setInstallScope((prev) => (prev === 'user' ? 'project' : 'user'));
        return;
      }
      return;
    }

    // Main view handling
    if (key.escape) {
      onExit({ installed: false });
      return;
    }

    if (key.tab) {
      const tabs: SkillsBrowserTab[] = ['featured', 'categories', 'search'];
      const currentIdx = tabs.indexOf(activeTab);
      setActiveTab(tabs[(currentIdx + 1) % tabs.length]);
      setSelectedIndex(0);
      setSearchQuery('');
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((prev) => Math.min(prev + 1, filteredSkills.length - 1));
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
      return;
    }

    if (key.return && selectedSkill) {
      setShowInstallModal(true);
      return;
    }

    // Search input (only in search tab)
    if (activeTab === 'search') {
      if (key.backspace || key.delete) {
        setSearchQuery((prev) => prev.slice(0, -1));
        setSelectedIndex(0);
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setSearchQuery((prev) => prev + input);
        setSelectedIndex(0);
      }
    }

    // Category selection (in categories tab)
    if (activeTab === 'categories' && !selectedCategory) {
      if (key.return) {
        const cat = registry.categories[selectedIndex];
        if (cat) {
          setSelectedCategory(cat.id);
          setSelectedIndex(0);
        }
        return;
      }
    }

    // Back to category list
    if (activeTab === 'categories' && selectedCategory && key.backspace) {
      setSelectedCategory(null);
      setSelectedIndex(0);
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Community Skills Marketplace
        </Text>
        <Box marginLeft={2}>
          <Text color="gray">[ESC] Exit</Text>
        </Box>
      </Box>

      {/* Tab Bar */}
      <TabBar activeTab={activeTab} />

      {/* Search Input (visible in search tab) */}
      {activeTab === 'search' && <SearchInput value={searchQuery} />}

      {/* Main Content */}
      <Box flexDirection="row" marginTop={1}>
        {/* Skills/Category List */}
        <Box width="60%">
          {activeTab === 'categories' && !selectedCategory ? (
            <CategoryList
              categories={registry.categories}
              selectedIndex={selectedIndex}
            />
          ) : (
            <SkillsList
              skills={filteredSkills}
              selectedIndex={selectedIndex}
            />
          )}
        </Box>

        {/* Preview Panel */}
        <Box width="40%" marginLeft={1}>
          <SkillPreview skill={selectedSkill} />
        </Box>
      </Box>

      {/* Footer Help */}
      <Box marginTop={1}>
        <Text color="gray">
          {activeTab === 'categories' && !selectedCategory
            ? 'Enter Select  Tab Switch tabs  Esc Exit'
            : 'Enter Install  Tab Switch tabs  Esc Exit'}
        </Text>
      </Box>

      {/* Install Modal */}
      {showInstallModal && selectedSkill && (
        <InstallModal
          skill={selectedSkill}
          scope={installScope}
          isInstalling={isInstalling}
        />
      )}
    </Box>
  );
}

// ============ Sub-Components ============

function TabBar({ activeTab }: { activeTab: SkillsBrowserTab }) {
  const tabs: { id: SkillsBrowserTab; label: string }[] = [
    { id: 'featured', label: 'Featured' },
    { id: 'categories', label: 'Categories' },
    { id: 'search', label: 'Search' },
  ];

  return (
    <Box>
      {tabs.map((tab, i) => (
        <React.Fragment key={tab.id}>
          {i > 0 && <Text color="gray"> </Text>}
          <Text
            bold={activeTab === tab.id}
            color={activeTab === tab.id ? 'cyan' : 'gray'}
          >
            [{tab.label}]
          </Text>
        </React.Fragment>
      ))}
    </Box>
  );
}

function SearchInput({ value }: { value: string }) {
  return (
    <Box marginTop={1}>
      <Text>Filter: </Text>
      <Text color="cyan">{value || ' '}</Text>
      <Text color="gray">_</Text>
    </Box>
  );
}

interface CategoryListProps {
  categories: CommunitySkillsRegistry['categories'];
  selectedIndex: number;
}

function CategoryList({ categories, selectedIndex }: CategoryListProps) {
  const visibleCount = 10;
  const startIndex = Math.max(
    0,
    Math.min(selectedIndex - Math.floor(visibleCount / 2), categories.length - visibleCount)
  );
  const visible = categories.slice(startIndex, startIndex + visibleCount);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      <Text bold>Categories</Text>
      {visible.map((cat, idx) => {
        const actualIndex = startIndex + idx;
        const isSelected = actualIndex === selectedIndex;

        return (
          <Box key={cat.id}>
            <Text color={isSelected ? 'cyan' : undefined}>
              {isSelected ? '>' : ' '} {cat.name} ({cat.count})
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

interface SkillsListProps {
  skills: GitHubCommunitySkill[];
  selectedIndex: number;
}

function SkillsList({ skills, selectedIndex }: SkillsListProps) {
  const visibleCount = 8;
  const startIndex = Math.max(
    0,
    Math.min(selectedIndex - Math.floor(visibleCount / 2), skills.length - visibleCount)
  );
  const visible = skills.slice(startIndex, startIndex + visibleCount);

  if (skills.length === 0) {
    return (
      <Box borderStyle="round" borderColor="gray" paddingX={1}>
        <Text color="gray">No skills found</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      <Text bold>Skills ({skills.length} results)</Text>
      {visible.map((skill, idx) => {
        const actualIndex = startIndex + idx;
        const isSelected = actualIndex === selectedIndex;

        return (
          <Box key={skill.id} flexDirection="column" marginTop={idx > 0 ? 1 : 0}>
            <Box>
              <Text color={isSelected ? 'cyan' : undefined}>
                {isSelected ? '>' : ' '}
              </Text>
              {skill.isFeatured && <Text color="yellow">* </Text>}
              <Text bold={isSelected} color={isSelected ? 'cyan' : undefined}>
                {skill.name}
              </Text>
              {skill.rating && (
                <Text color="gray"> {skill.rating.toFixed(1)}</Text>
              )}
            </Box>
            <Box marginLeft={2}>
              <Text color="gray" wrap="truncate">
                {skill.description.slice(0, 45)}...
              </Text>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

function SkillPreview({ skill }: { skill: GitHubCommunitySkill | null }) {
  if (!skill) {
    return (
      <Box borderStyle="round" borderColor="gray" paddingX={1}>
        <Text color="gray">Select a skill to preview</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      <Text bold color="cyan">{skill.name}</Text>
      <Box marginTop={1}>
        <Text color="gray">{skill.description}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text>Category: <Text color="gray">{skill.category}</Text></Text>
        {skill.tags && skill.tags.length > 0 && (
          <Text>Tags: <Text color="gray">{skill.tags.slice(0, 3).join(', ')}</Text></Text>
        )}
        {skill.rating && (
          <Text>Rating: <Text color="yellow">{'*'.repeat(Math.round(skill.rating))}</Text> ({skill.rating.toFixed(1)})</Text>
        )}
        {skill.downloadCount && (
          <Text>Downloads: <Text color="gray">{formatDownloads(skill.downloadCount)}</Text></Text>
        )}
        {skill.files.length > 1 && (
          <Text>Files: <Text color="gray">{skill.files.length}</Text></Text>
        )}
      </Box>
      <Box marginTop={1}>
        <Text color="gray">[Enter] Install</Text>
      </Box>
    </Box>
  );
}

interface InstallModalProps {
  skill: GitHubCommunitySkill;
  scope: SkillInstallScope;
  isInstalling: boolean;
}

function InstallModal({ skill, scope, isInstalling }: InstallModalProps) {
  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="cyan"
      padding={1}
      marginTop={1}
    >
      <Text bold color="cyan">Install {skill.name}</Text>

      {isInstalling ? (
        <Box marginTop={1}>
          <Text color="yellow">Installing...</Text>
        </Box>
      ) : (
        <>
          <Box marginTop={1} flexDirection="column">
            <Text>Choose installation scope:</Text>

            <Box marginTop={1}>
              <Text color={scope === 'user' ? 'cyan' : 'gray'}>
                {scope === 'user' ? '(*) ' : '( ) '}
                User (~/.autohand/skills/)
              </Text>
            </Box>
            <Box marginLeft={4}>
              <Text color="gray">Available in all projects</Text>
            </Box>

            <Box marginTop={1}>
              <Text color={scope === 'project' ? 'cyan' : 'gray'}>
                {scope === 'project' ? '(*) ' : '( ) '}
                Project (.autohand/skills/)
              </Text>
            </Box>
            <Box marginLeft={4}>
              <Text color="gray">Available only in this project</Text>
            </Box>
          </Box>

          <Box marginTop={1}>
            <Text color="gray">
              Enter Confirm  Esc Cancel
            </Text>
          </Box>
        </>
      )}
    </Box>
  );
}

// ============ Helpers ============

function formatDownloads(count: number): string {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return String(count);
}
