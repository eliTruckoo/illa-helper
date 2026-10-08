# 🚀 Automated Release Guide

## 📋 Overview

This project is configured with an automated build and release pipeline. When a version tag is pushed, it automatically:
- Builds extension packages for all platforms (Chrome, Firefox, Safari)
- Creates a GitHub Release
- Uploads the build artifacts to the Release
- Generates release notes

## 🎯 Usage

### 1. Update the version number

First, update the version in `wxt.config.ts`:

```typescript
export default defineConfig({
  manifest: {
    version: '1.8.0', // Update the version here
    // ... other configuration
  },
});
```

### 2. Commit the changes

```bash
git add .
git commit -m "🔖 Release v1.8.0"
git push origin master
```

### 3. Create and push a tag

```bash
# Create a version tag (must start with v)
git tag v1.8.0

# Push the tag to the remote repository
git push origin v1.8.0
```

### 4. The automated pipeline starts

After the tag is pushed, GitHub Actions automatically:

1. **Version check** - Verifies the tag version matches the version in the config file
2. **Code check** - Runs the TypeScript check and code format check
3. **Build extensions** - Builds the Chrome, Firefox and Safari extension packages
4. **Verify build** - Confirms all build artifacts exist and are valid
5. **Create Release** - Creates a new Release on GitHub
6. **Upload files** - Uploads the extension packages to the Release

## 📁 Build artifacts

The following files are generated after the build completes:
- `illa-helper-{version}-chrome.zip` - Chrome extension package
- `illa-helper-{version}-firefox.zip` - Firefox extension package  
- `illa-helper-{version}-safari.zip` - Safari extension package

## ⚠️ Notes

### Version number rules
- Must follow semantic versioning: `MAJOR.MINOR.PATCH`
- The tag must start with `v`, for example `v1.8.0`
- The tag version must exactly match the version in `wxt.config.ts`

### Handling common errors

**1. Version mismatch error**
```
❌ Error: tag version (1.8.0) does not match config file version (1.7.9)
```
Fix: make sure the version in `wxt.config.ts` matches the tag version

**2. Build failure**
- Check that the code passes TypeScript compilation
- Check for lint errors
- Make sure dependencies are installed correctly

**3. Tag already exists**
```bash
# Delete the local tag
git tag -d v1.8.0

# Delete the remote tag
git push origin :refs/tags/v1.8.0

# Recreate the tag
git tag v1.8.0
git push origin v1.8.0
```

## 🔧 Advanced usage

### Pre-release versions

Create a pre-release version (such as beta or rc):

```bash
# Update the version to 1.8.0-beta.1
git tag v1.8.0-beta.1
git push origin v1.8.0-beta.1
```

### Manually triggering a build

To rebuild an existing tag:

```bash
# Delete and recreate the tag
git tag -d v1.8.0
git push origin :refs/tags/v1.8.0
git tag v1.8.0
git push origin v1.8.0
```

## 📊 Checking release status

### View build status
1. Open the project's GitHub Actions page
2. Find the "Release Build and Publish" workflow
3. Click it to view the detailed build logs

### Verify the release
1. Open the project's Releases page
2. Confirm the new version was created
3. Check that all three extension package files are included

## 🆘 Troubleshooting

### Build failure checklist

1. **Check the local build**
   ```bash
   npm ci
   npm run compile
   npm run lint
   npm run zip:all
   ```

2. **Check version consistency**
   ```bash
   # Check the version in the config file
   grep "version:" wxt.config.ts
   
   # Check the tags
   git tag --list | tail -5
   ```

3. **View detailed error logs**
   - Look at the failed step on the GitHub Actions page
   - Read the error message and fix the corresponding issue

### Getting support

If you run into a problem you cannot solve:
1. Review the full GitHub Actions logs
2. Check the project's GitHub Issues page
3. Create a new Issue with detailed error information

---

## 📝 Release checklist

Use this checklist to make sure every release is done correctly:

- [ ] Update the version in `wxt.config.ts`
- [ ] Commit all changes to the master branch
- [ ] Create the matching version tag (format: vMAJOR.MINOR.PATCH)
- [ ] Push the tag to the remote repository
- [ ] Confirm the GitHub Actions build succeeds
- [ ] Verify the Release page contains all extension packages
- [ ] Test that the downloaded extension packages work

🎉 **Congratulations! You have mastered the automated release process!**
