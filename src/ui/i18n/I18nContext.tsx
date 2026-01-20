/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import type { FC, ReactNode } from 'react';
import { t as translate, getCurrentLocale, onLanguageChange } from '../../i18n/index.js';
import type { SupportedLocale } from '../../i18n/index.js';

/**
 * I18n context value.
 */
export interface I18nContextValue {
  /** Translation function */
  t: typeof translate;
  /** Current locale */
  locale: SupportedLocale;
}

/**
 * Default context value.
 */
const defaultContextValue: I18nContextValue = {
  t: translate,
  locale: 'en',
};

/**
 * React context for i18n.
 */
export const I18nContext = createContext<I18nContextValue>(defaultContextValue);

/**
 * Props for I18nProvider.
 */
export interface I18nProviderProps {
  /** Children components */
  children: ReactNode;
}

/**
 * I18n provider component for Ink applications.
 * Provides translation context to all child components and
 * re-renders them when locale changes.
 */
export const I18nProvider: FC<I18nProviderProps> = ({ children }) => {
  const [locale, setLocale] = useState<SupportedLocale>(getCurrentLocale());

  // Subscribe to language changes
  useEffect(() => {
    const unsubscribe = onLanguageChange((newLocale) => {
      setLocale(newLocale);
    });

    return unsubscribe;
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({
      t: translate,
      locale,
    }),
    [locale]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

/**
 * Hook to access translations in Ink components.
 *
 * @example
 * ```tsx
 * const { t, locale } = useTranslation();
 * return <Text>{t('ui.escToCancel')}</Text>;
 * ```
 */
export function useTranslation(): I18nContextValue {
  const context = useContext(I18nContext);
  return context;
}
