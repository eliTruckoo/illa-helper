#!/usr/bin/env node

/**
 * Automated release script
 * Simplified release flow: bump version -> commit -> create tag -> push
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ReleaseManager {
  constructor() {
    this.configPath = path.join(process.cwd(), 'wxt.config.ts');
    this.packagePath = path.join(process.cwd(), 'package.json');
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  /**
   * Interactive prompt
   */
  async question(query) {
    return new Promise((resolve) => {
      this.rl.question(query, resolve);
    });
  }

  /**
   * Confirmation prompt (y/n)
   */
  async confirm(message, defaultValue = false) {
    const defaultStr = defaultValue ? 'Y/n' : 'y/N';
    const answer = await this.question(`${message} (${defaultStr}): `);

    if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
      return true;
    } else if (answer.toLowerCase() === 'n' || answer.toLowerCase() === 'no') {
      return false;
    } else {
      return defaultValue;
    }
  }

  /**
   * Selection prompt
   */
  async choice(message, options, defaultIndex = 0) {
    console.log(`\n${message}`);
    options.forEach((option, index) => {
      const marker = index === defaultIndex ? '→' : ' ';
      console.log(`${marker} ${index + 1}. ${option}`);
    });

    const answer = await this.question(
      `\nSelect (1-${options.length}, default: ${defaultIndex + 1}): `,
    );
    const index = parseInt(answer) - 1;

    if (isNaN(index) || index < 0 || index >= options.length) {
      return defaultIndex;
    }

    return index;
  }

  /**
   * Close the interactive interface
   */
  closeInterface() {
    this.rl.close();
  }

  /**
   * Run a system command
   */
  exec(command, showOutput = true) {
    try {
      const result = execSync(command, {
        encoding: 'utf8',
        stdio: showOutput ? 'inherit' : 'pipe',
      });
      return result;
    } catch (error) {
      console.error(`❌ Command failed: ${command}`);
      console.error(error.message);
      process.exit(1);
    }
  }

  /**
   * Get the current version
   */
  getCurrentVersion() {
    if (!fs.existsSync(this.packagePath)) {
      console.error('❌ package.json not found');
      process.exit(1);
    }

    try {
      const packageJson = JSON.parse(fs.readFileSync(this.packagePath, 'utf8'));
      return packageJson.version;
    } catch (error) {
      console.error(
        '❌ Could not read the version from package.json:',
        error.message,
      );
      process.exit(1);
    }
  }

  /**
   * Validate the version format
   */
  validateVersion(version) {
    const semverRegex = /^\d+\.\d+\.\d+(-[a-zA-Z0-9]+(\.\d+)?)?$/;
    if (!semverRegex.test(version)) {
      console.error(
        '❌ Invalid version format, please use semantic versioning (e.g. 1.8.0, 1.8.0-beta.1)',
      );
      process.exit(1);
    }
  }

  /**
   * Check the working directory status
   */
  checkWorkingDirectory() {
    try {
      const status = this.exec('git status --porcelain', false);
      return status.trim() === '';
    } catch {
      return false;
    }
  }

  /**
   * Check whether inside a git repository
   */
  checkGitRepository() {
    try {
      this.exec('git rev-parse --git-dir', false);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check whether the tag already exists
   */
  checkTagExists(tag) {
    try {
      // Check the tag in silent mode, without showing error output
      execSync(`git rev-parse ${tag}`, {
        encoding: 'utf8',
        stdio: 'pipe',
      });
      return true;
    } catch {
      // A missing tag is the normal case, return false
      return false;
    }
  }

  /**
   * Check whether a command-line tool is available
   */
  isCommandAvailable(command) {
    try {
      // Use 'pipe' to suppress output; a missing command will still throw
      execSync(`${command} --version`, { stdio: 'pipe' });
      return true;
    } catch (_error) {
      return false;
    }
  }

  /**
   * Delete tag
   */
  deleteReleaseAssets(version) {
    const tag = `v${version}`;
    console.log(`🗑️  Deleting existing Release and tag: ${tag}`);

    // Check whether gh is available
    if (this.isCommandAvailable('gh')) {
      try {
        // Delete the GitHub Release
        console.log('💥 Deleting GitHub Release...');
        this.exec(`gh repo set-default eliTruckoo/illa-helper`);

        try {
          execSync(`gh release delete ${tag} --yes`, {
            encoding: 'utf8',
            stdio: 'pipe',
          });
          console.log('✅ GitHub Release deleted');
        } catch (error) {
          // Check whether this is a "release not found" error
          if (error.message && error.message.includes('not found')) {
            console.log('ℹ️ GitHub Release does not exist, skipping deletion');
          } else {
            console.log('ℹ️ GitHub Release deletion failed, skipping');
            console.log(`   Error: ${error.message}`);
          }
        }
      } catch (_error) {
        console.log('ℹ️ GitHub Release operation failed, skipping');
      }
    } else {
      console.log(
        "⚠️ GitHub CLI ('gh') is not installed or not in PATH, skipping the Release deletion step.",
      );
      console.log('   Visit https://cli.github.com/ to install it.');
    }

    try {
      // Delete the local tag
      this.exec(`git tag -d ${tag}`);
      console.log('✅ Local tag deleted');
    } catch (_error) {
      console.log('ℹ️ Local tag does not exist, skipping');
    }

    try {
      // Delete the remote tag
      this.exec(`git push origin :refs/tags/${tag}`);
      console.log('✅ Remote tag deleted');
    } catch (_error) {
      console.log('ℹ️ Remote tag does not exist, skipping');
    }
  }

  /**
   * Commit changes (if any)
   */
  async commitChanges(version) {
    // Check whether there are changes to commit
    if (this.checkWorkingDirectory()) {
      console.log('ℹ️ Working directory is clean, nothing to commit');
      return;
    }

    console.log('📤 Committing version changes...');

    // Show the files about to be committed
    try {
      const status = execSync('git status --porcelain', { encoding: 'utf8' });
      console.log('📄 Files about to be committed:');
      status
        .split('\n')
        .filter((line) => line.trim())
        .forEach((line) => {
          console.log(`   ${line}`);
        });
    } catch (_error) {
      // Ignore the error and continue
    }

    this.exec(`git add .`);
    this.exec(`git commit -m "🔖 Release version v${version}"`);
    console.log('✅ Changes committed');
  }

  /**
   * Create and push the tag
   */
  createAndPushTag(version) {
    const tag = `v${version}`;

    // The main flow already handles tag conflicts, so this is only a warning
    if (this.checkTagExists(tag)) {
      console.log(
        `ℹ️ Tag ${tag} still exists, trying to delete and recreate it...`,
      );
      try {
        this.exec(`git tag -d ${tag}`, false);
      } catch (_error) {
        // Ignore the deletion failure and try to create anyway
      }
    }

    console.log(`🏷️ Creating tag: ${tag}`);
    this.exec(`git tag ${tag}`);

    console.log('📤 Pushing to the remote repository...');
    this.exec('git push origin master');
    this.exec(`git push origin ${tag}`);

    console.log('✅ Tag pushed');
  }

  /**
   * Show release info
   */
  showReleaseInfo(version) {
    console.log('\n🎉 Release flow started!\n');
    console.log('📊 Release info:');
    console.log(`   Version: v${version}`);
    console.log(`   Tag: v${version}`);
    console.log('\n📋 What happens next:');
    console.log('   ✅ GitHub Actions starts the build');
    console.log('   ✅ Build extension packages for all platforms');
    console.log('   ✅ Create the GitHub Release');
    console.log('   ✅ Upload build artifacts');

    console.log('\n🔗 View progress:');
    console.log(
      '   GitHub Actions: https://github.com/eliTruckoo/illa-helper/actions',
    );
    console.log(
      '   Releases: https://github.com/eliTruckoo/illa-helper/releases',
    );
  }

  /**
   * Main release flow
   */
  async release(options = {}) {
    try {
      console.log('🚀 Starting automated release flow\n');

      // Pre-checks
      if (!this.checkGitRepository()) {
        console.error('❌ Current directory is not a Git repository');
        process.exit(1);
      }

      // Read the current version
      const currentVersion = this.getCurrentVersion();
      console.log(`📋 Preparing to release version: v${currentVersion}`);

      // Validate the version format
      this.validateVersion(currentVersion);

      // Confirm before releasing
      if (!options.force) {
        const confirmed = await this.confirm(
          `\n🎯 Confirm release of version v${currentVersion}?`,
          true,
        );
        if (!confirmed) {
          console.log('❌ Release cancelled');
          return;
        }
      }

      // Check whether this version was already released
      if (this.checkTagExists(`v${currentVersion}`)) {
        console.log(`⚠️ Version v${currentVersion} was already released`);
        const deleteConfirmed = await this.confirm(
          '🗑️ Delete the existing tag and GitHub Release and release again?',
          true,
        );
        if (deleteConfirmed) {
          this.deleteReleaseAssets(currentVersion);
          console.log(`✅ Existing version deleted, continuing release flow`);
        } else {
          console.log('❌ Release cancelled');
          return;
        }
      }

      // Check the working directory
      if (!this.checkWorkingDirectory()) {
        const choice = await this.choice(
          '⚠️ The working directory has uncommitted changes, choose an action:',
          [
            'Cancel the release, commit manually and retry',
            'Commit changes automatically and continue',
            'Ignore changes and force the release',
          ],
          0,
        );

        switch (choice) {
          case 0:
            console.log(
              '❌ Release cancelled, please commit your changes first',
            );
            return;
          case 1:
            console.log('📝 Committing changes automatically...');
            break;
          case 2:
            console.log('⚠️ Ignoring changes and forcing the release...');
            options.force = true;
            break;
        }
      }

      console.log(`\n✅ Starting release of version: v${currentVersion}`);

      // Commit changes (if any)
      await this.commitChanges(currentVersion);

      // Final confirmation
      const finalConfirm = await this.confirm(
        '\n🚨 Final confirmation: about to push to the remote and trigger the automated build. Continue?',
        true,
      );
      if (!finalConfirm) {
        console.log('❌ Release cancelled');
        return;
      }

      // Create and push the tag
      this.createAndPushTag(currentVersion);

      // Show release info
      this.showReleaseInfo(currentVersion);
    } catch (error) {
      console.error('❌ An error occurred during release:', error.message);
      process.exit(1);
    } finally {
      this.closeInterface();
    }
  }
}

// Command-line argument handling
function parseArguments() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
🚀 Interactive automated release script

Usage:
  node scripts/release.js [options]
  npm run release [-- options]

Options:
  --force       Skip all interactive confirmations and force execution
  --help, -h    Show help

Examples:
  node scripts/release.js          # Interactive release
  node scripts/release.js --force  # Forced release (non-interactive)
  npm run release                  # Interactive release
  npm run release -- --force      # Forced release (non-interactive)

Interactive features:
  ✅ Confirm version info before release
  ✅ Offer choices on version conflict (cancel/delete/force)
  ✅ Offer choices on uncommitted changes (cancel/commit/ignore)
  ✅ Final confirmation before pushing
  ✅ Show the list of files about to be committed

Release flow:
  1. Read the version from package.json
  2. Confirm release info interactively
  3. Handle version conflicts and changes
  4. Commit changes to git (if needed)
  5. Create the version tag
  6. Push to the remote repository
  7. Trigger the GitHub Actions build and release

Notes:
  Update the version in package.json manually before releasing
  Press Ctrl+C to cancel the release at any time
    `);
    process.exit(0);
  }

  const options = {
    force: args.includes('--force'),
  };

  return { options };
}

// Main entry point
async function main() {
  try {
    const { options } = parseArguments();
    const releaseManager = new ReleaseManager();
    await releaseManager.release(options);
  } catch (error) {
    console.error('❌ Release failed:', error.message);
    process.exit(1);
  }
}

// Run the main program
// Check whether this script is run directly (not imported)
const scriptPath = fileURLToPath(import.meta.url);
const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === scriptPath;

if (isMainModule) {
  main();
}

export default ReleaseManager;
