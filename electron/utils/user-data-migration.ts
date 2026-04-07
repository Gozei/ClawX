import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { dirname, join } from 'node:path';
import { app } from 'electron';

const LEGACY_USER_DATA_DIR_NAME = 'clawx';
const SETTINGS_FILE_NAME = 'settings.json';
const PROVIDER_STORE_FILE_NAME = 'clawx-providers.json';
const DEVICE_IDENTITY_FILE_NAME = 'clawx-device-identity.json';

type JsonRecord = Record<string, unknown>;

export interface UserDataMigrationReport {
  legacyUserDataDir: string;
  currentUserDataDir: string;
  migratedFiles: string[];
  mergedFiles: string[];
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  return true;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readJsonRecord(path: string): Promise<JsonRecord | null> {
  if (!(await pathExists(path))) {
    return null;
  }

  try {
    const content = await readFile(path, 'utf8');
    const parsed = JSON.parse(content) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function writeJsonRecord(path: string, data: JsonRecord): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function getLegacyUserDataDir(currentUserDataDir: string): string {
  return join(dirname(currentUserDataDir), LEGACY_USER_DATA_DIR_NAME);
}

function pickPreferredScalar(currentValue: unknown, legacyValue: unknown): unknown {
  return isMeaningfulValue(currentValue) ? currentValue : legacyValue;
}

function mergeSettingsData(legacyData: JsonRecord, currentData: JsonRecord): JsonRecord {
  return {
    ...legacyData,
    ...currentData,
  };
}

function normalizeComparableValue(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function getAccountSignature(account: JsonRecord): string {
  return [
    normalizeComparableValue(account.vendorId),
    normalizeComparableValue(account.baseUrl),
    normalizeComparableValue(account.model),
    normalizeComparableValue(account.label),
  ].join('|');
}

function getLooseAccountSignature(account: JsonRecord): string {
  return [
    normalizeComparableValue(account.vendorId),
    normalizeComparableValue(account.authMode),
    normalizeComparableValue(account.baseUrl),
  ].join('|');
}

function mapLegacySecretsToCurrentAccounts(
  legacyAccounts: Record<string, unknown>,
  currentAccounts: Record<string, unknown>,
  legacySecrets: Record<string, unknown>,
  currentSecrets: Record<string, unknown>,
): Record<string, unknown> {
  const nextSecrets = { ...currentSecrets };
  const usedLegacyIds = new Set<string>();
  const currentIdsWithSecrets = new Set(Object.keys(currentSecrets));

  for (const currentId of Object.keys(currentAccounts)) {
    if (currentIdsWithSecrets.has(currentId)) {
      continue;
    }

    if (legacySecrets[currentId] !== undefined) {
      const secret = legacySecrets[currentId];
      if (isRecord(secret)) {
        nextSecrets[currentId] = { ...secret, accountId: currentId };
      } else {
        nextSecrets[currentId] = secret;
      }
      usedLegacyIds.add(currentId);
      continue;
    }

    const currentAccount = currentAccounts[currentId];
    if (!isRecord(currentAccount)) {
      continue;
    }

    const strictSignature = getAccountSignature(currentAccount);
    const looseSignature = getLooseAccountSignature(currentAccount);
    if (!strictSignature.replace(/\|/g, '') && !looseSignature.replace(/\|/g, '')) {
      continue;
    }

    const matchingLegacyEntries = Object.entries(legacyAccounts)
      .filter(([legacyId, legacyAccount]) => {
        if (usedLegacyIds.has(legacyId) || legacySecrets[legacyId] === undefined) {
          return false;
        }
        if (!isRecord(legacyAccount)) {
          return false;
        }
        return getAccountSignature(legacyAccount) === strictSignature;
      });

    const matchingLegacyIds = matchingLegacyEntries.length === 1
      ? matchingLegacyEntries.map(([legacyId]) => legacyId)
      : Object.entries(legacyAccounts)
        .filter(([legacyId, legacyAccount]) => {
          if (usedLegacyIds.has(legacyId) || legacySecrets[legacyId] === undefined) {
            return false;
          }
          if (!isRecord(legacyAccount)) {
            return false;
          }
          return getLooseAccountSignature(legacyAccount) === looseSignature;
        })
        .map(([legacyId]) => legacyId);

    if (matchingLegacyIds.length !== 1) {
      continue;
    }

    const matchedLegacyId = matchingLegacyIds[0];
    const matchedSecret = legacySecrets[matchedLegacyId];
    if (isRecord(matchedSecret)) {
      nextSecrets[currentId] = { ...matchedSecret, accountId: currentId };
    } else {
      nextSecrets[currentId] = matchedSecret;
    }
    usedLegacyIds.add(matchedLegacyId);
  }

  return nextSecrets;
}

function deriveApiKeysFromSecrets(secrets: Record<string, unknown>): Record<string, string> {
  const apiKeys: Record<string, string> = {};

  for (const [accountId, secret] of Object.entries(secrets)) {
    if (!isRecord(secret)) {
      continue;
    }

    const secretType = secret.type;
    if (secretType === 'api_key' && typeof secret.apiKey === 'string' && secret.apiKey.trim()) {
      apiKeys[accountId] = secret.apiKey;
      continue;
    }

    if (secretType === 'local' && typeof secret.apiKey === 'string' && secret.apiKey.trim()) {
      apiKeys[accountId] = secret.apiKey;
    }
  }

  return apiKeys;
}

export function mergeProviderStoreData(legacyData: JsonRecord, currentData: JsonRecord): JsonRecord {
  const legacyAccounts = isRecord(legacyData.providerAccounts)
    ? (legacyData.providerAccounts as Record<string, unknown>)
    : {};
  const currentAccounts = isRecord(currentData.providerAccounts)
    ? (currentData.providerAccounts as Record<string, unknown>)
    : {};
  const legacyProviders = isRecord(legacyData.providers)
    ? (legacyData.providers as Record<string, unknown>)
    : {};
  const currentProviders = isRecord(currentData.providers)
    ? (currentData.providers as Record<string, unknown>)
    : {};
  const legacySecrets = isRecord(legacyData.providerSecrets)
    ? (legacyData.providerSecrets as Record<string, unknown>)
    : {};
  const currentSecrets = isRecord(currentData.providerSecrets)
    ? (currentData.providerSecrets as Record<string, unknown>)
    : {};
  const legacyApiKeys = isRecord(legacyData.apiKeys)
    ? (legacyData.apiKeys as Record<string, unknown>)
    : {};
  const currentApiKeys = isRecord(currentData.apiKeys)
    ? (currentData.apiKeys as Record<string, unknown>)
    : {};

  const mergedAccounts = {
    ...legacyAccounts,
    ...currentAccounts,
  };
  const mergedProviders = {
    ...legacyProviders,
    ...currentProviders,
  };
  const mergedSecrets = mapLegacySecretsToCurrentAccounts(
    legacyAccounts,
    currentAccounts,
    legacySecrets,
    currentSecrets,
  );
  const mergedApiKeys = {
    ...legacyApiKeys,
    ...deriveApiKeysFromSecrets(mergedSecrets),
    ...currentApiKeys,
  };

  return {
    ...legacyData,
    ...currentData,
    providers: mergedProviders,
    providerAccounts: mergedAccounts,
    providerSecrets: mergedSecrets,
    apiKeys: mergedApiKeys,
    schemaVersion: pickPreferredScalar(currentData.schemaVersion, legacyData.schemaVersion) ?? 0,
    defaultProvider: pickPreferredScalar(currentData.defaultProvider, legacyData.defaultProvider) ?? null,
    defaultProviderAccountId:
      pickPreferredScalar(currentData.defaultProviderAccountId, legacyData.defaultProviderAccountId) ?? null,
  };
}

async function mergeJsonFile(
  legacyPath: string,
  currentPath: string,
  merge: (legacyData: JsonRecord, currentData: JsonRecord) => JsonRecord,
): Promise<boolean> {
  const legacyData = await readJsonRecord(legacyPath);
  if (!legacyData) {
    return false;
  }

  const currentData = await readJsonRecord(currentPath);
  const nextData = merge(legacyData, currentData ?? {});
  const previousSerialized = currentData ? JSON.stringify(currentData) : null;
  const nextSerialized = JSON.stringify(nextData);

  if (previousSerialized === nextSerialized) {
    return false;
  }

  await writeJsonRecord(currentPath, nextData);
  return true;
}

async function copyFileIfMissing(legacyPath: string, currentPath: string): Promise<boolean> {
  if (!(await pathExists(legacyPath)) || (await pathExists(currentPath))) {
    return false;
  }

  await mkdir(dirname(currentPath), { recursive: true });
  await copyFile(legacyPath, currentPath);
  return true;
}

export async function migrateLegacyUserDataIfNeeded(): Promise<UserDataMigrationReport | null> {
  const currentUserDataDir = app.getPath('userData');
  const legacyUserDataDir = getLegacyUserDataDir(currentUserDataDir);

  if (currentUserDataDir === legacyUserDataDir || !(await pathExists(legacyUserDataDir))) {
    return null;
  }

  const report: UserDataMigrationReport = {
    legacyUserDataDir,
    currentUserDataDir,
    migratedFiles: [],
    mergedFiles: [],
  };

  const settingsMerged = await mergeJsonFile(
    join(legacyUserDataDir, SETTINGS_FILE_NAME),
    join(currentUserDataDir, SETTINGS_FILE_NAME),
    mergeSettingsData,
  );
  if (settingsMerged) {
    report.mergedFiles.push(SETTINGS_FILE_NAME);
  }

  const providerStoreMerged = await mergeJsonFile(
    join(legacyUserDataDir, PROVIDER_STORE_FILE_NAME),
    join(currentUserDataDir, PROVIDER_STORE_FILE_NAME),
    mergeProviderStoreData,
  );
  if (providerStoreMerged) {
    report.mergedFiles.push(PROVIDER_STORE_FILE_NAME);
  }

  const deviceIdentityCopied = await copyFileIfMissing(
    join(legacyUserDataDir, DEVICE_IDENTITY_FILE_NAME),
    join(currentUserDataDir, DEVICE_IDENTITY_FILE_NAME),
  );
  if (deviceIdentityCopied) {
    report.migratedFiles.push(DEVICE_IDENTITY_FILE_NAME);
  }

  return report.mergedFiles.length > 0 || report.migratedFiles.length > 0 ? report : null;
}
