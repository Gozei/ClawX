import { runStartupModelNamingRepair, type StartupModelNamingRepairReport } from './model-naming-repair';

export type StartupSelfCheckReport = {
  modelNaming: StartupModelNamingRepairReport;
};

export async function runStartupSelfChecks(): Promise<StartupSelfCheckReport> {
  return {
    modelNaming: await runStartupModelNamingRepair(),
  };
}

export { runStartupModelNamingRepair };
