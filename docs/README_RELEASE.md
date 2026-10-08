# 🚀 Automated Release System

## Quick Start

### Method 1: Use the release script (recommended)

```bash
# Release a new version
npm run release 1.8.0

# Release a beta version
npm run release 1.8.0-beta.1

# Force release (ignore uncommitted changes)
npm run release 1.8.0 -- --force
```

### Method 2: Manual release

```bash
# 1. Update the version number (in wxt.config.ts)
# 2. Commit the changes
git add .
git commit -m "🔖 Release version v1.8.0"

# 3. Create and push the tag
git tag v1.8.0
git push origin master
git push origin v1.8.0
```

## Components

- **`.github/workflows/release.yml`** - GitHub Actions workflow
- **`scripts/release.js`** - Automated release script
- **`docs/RELEASE_GUIDE.md`** - Detailed usage guide

## Release Process

1. 📝 Update the version number
2. 🔍 Code quality checks
3. 🏗️ Build extension packages for all platforms
4. 🎁 Create the GitHub Release
5. 📤 Upload build artifacts

## Build Artifacts

- `elilla-assistant-{version}-chrome.zip`
- `elilla-assistant-{version}-firefox.zip`
- `elilla-assistant-{version}-safari.zip`

---

For more details, see the [Release Guide](docs/RELEASE_GUIDE.md) 