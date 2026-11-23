/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Autohand account this CLI acts for, when the person chose one. `AUTOHAND_ACCOUNT_ID` wins
 * over the saved choice so a shell or CI run can pin an account. Unset means the API picks: the
 * personal account, or the subscribed team a free member belongs to.
 */
type AccountChoiceSource = { api?: { accountId?: string } };

export function selectedAccountId(config?: AccountChoiceSource): string | undefined {
  const fromEnv = process.env.AUTOHAND_ACCOUNT_ID?.trim();
  if (fromEnv) return fromEnv;
  const saved = config?.api?.accountId?.trim();
  return saved || undefined;
}

type EntitlementTokenSource = {
  auth?: { token?: string };
  autohandai?: { plan?: string; authMode?: string; accountToken?: string; apiKey?: string };
};

const present = (value: string | undefined): string | undefined => value?.trim() ? value : undefined;

/**
 * The credential whose plan the CLI should report: the same identity Autohand Cloud inference
 * bills. A fresh sign-in (`auth.token`) wins over an `accountToken` left by an older sign-in, as
 * in ProviderFactory; api-key mode reports the key's account because that is what requests send.
 */
export function entitlementToken(config: EntitlementTokenSource, provider: string | undefined): string | undefined {
  const login = present(config.auth?.token);
  const cloud = config.autohandai;
  if (provider !== 'autohandai' || cloud?.plan === 'local') return login;
  return cloud?.authMode === 'account'
    ? login ?? present(cloud.accountToken)
    : present(cloud?.apiKey) ?? login;
}

export function accountHeaders(config?: AccountChoiceSource): Record<string, string> {
  const accountId = selectedAccountId(config);
  return accountId ? { 'X-Autohand-Account-Id': accountId } : {};
}
