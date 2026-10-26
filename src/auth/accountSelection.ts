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

export function accountHeaders(config?: AccountChoiceSource): Record<string, string> {
  const accountId = selectedAccountId(config);
  return accountId ? { 'X-Autohand-Account-Id': accountId } : {};
}
