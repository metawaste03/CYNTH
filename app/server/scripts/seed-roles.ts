/**
 * One-time setup: register the default models and assign the production roles.
 *
 * Idempotent. Re-running adds anything missing without undoing a deliberate
 * reassignment — pass --overwrite to reset the roles to the defaults.
 */
import { loadSecrets } from '../src/shared/secrets/secretStore.js';
import { initializeDatabase, closeDatabase } from '../src/shared/database/index.js';
import { seedDevelopmentRoles, seedRoleDefaults } from '../src/features/pipeline/roleDefaults.service.js';
import { listRoleAssignments } from '../src/features/pipeline/roleRegistry.repository.js';

loadSecrets();
initializeDatabase();

const overwrite = process.argv.includes('--overwrite');
const production = seedRoleDefaults({ overwriteRoles: overwrite });
console.log(
  `Models: ${production.modelsAdded} added, ${production.modelsExisting} already present. ` +
    `Production roles assigned: ${production.rolesAssigned}.`,
);
for (const issue of production.issues) console.log(`  ! ${issue}`);

const development = seedDevelopmentRoles();
console.log(`Development roles assigned: ${development.rolesAssigned}.`);
for (const issue of development.issues) console.log(`  ! ${issue}`);

for (const mode of ['production', 'development'] as const) {
  console.log(`\n--- ${mode.toUpperCase()} ---`);
  for (const role of listRoleAssignments(mode)) {
    console.log(
      `  ${role.label.padEnd(18)} primary: ${(role.primary?.modelName ?? 'unassigned').padEnd(32)} fallback: ${role.fallback?.modelName ?? '—'}`,
    );
  }
}

closeDatabase();
