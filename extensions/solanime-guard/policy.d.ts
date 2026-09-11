export interface GuardOptions { enabled: boolean; strict: boolean; mediaHosts: string[]; }
export interface GuardTheme { accent: string; ink: string; mode: 'dark' | 'light'; }
export interface GuardRule { id: number; priority: number; action: {type: 'block'}; condition: {tabIds: number[]; initiatorDomains: string[]; requestDomains?: string[]; excludedRequestDomains?: string[]; resourceTypes: string[]; domainType?: 'thirdParty'}; }
export const DEFAULTS: GuardOptions;
export const PROVIDER: string;
export const TRACKERS: string[];
export function isProjectUrl(input: unknown): boolean;
export function isProviderUrl(input: unknown): boolean;
export function validateHosts(value: unknown): string[];
export function settings(value: unknown): GuardOptions;
export function buildRules(tabIds: number[], options: GuardOptions): GuardRule[];
export function theme(value: unknown): GuardTheme;
export function playerCss(value: unknown): string;
