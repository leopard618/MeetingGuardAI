# Import Standards and Best Practices

## Import Path Standards

### ✅ Correct Import Patterns
```javascript
// For local modules - NO file extensions
import calendarSyncManager from '../api/calendarSyncManager';
import { Meeting } from '../api/entities';
import CustomHeader from '../components/CustomHeader';

// For external packages - use package names
import React from 'react';
import { View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
```

### ❌ Incorrect Import Patterns
```javascript
// DON'T use .js extensions for local imports
import calendarSyncManager from '../api/calendarSyncManager.js';
import { Meeting } from '../api/entities.js';

// DON'T use .jsx extensions for React components
import CustomHeader from '../components/CustomHeader.jsx';
```

## Metro Bundler Compatibility

### Why No Extensions?
- Metro bundler automatically resolves file extensions
- Using explicit extensions can cause resolution conflicts
- React Native/Expo projects expect extensionless imports for local modules

### File Extension Resolution Order
Metro bundler tries these extensions in order:
1. `.native.js` (for React Native specific files)
2. `.android.js` (for Android specific files)
3. `.ios.js` (for iOS specific files)
4. `.js` (default JavaScript files)
5. `.jsx` (for React components)
6. `.ts` (for TypeScript files)
7. `.tsx` (for TypeScript React components)

## Code Review Checklist

### Before Committing
- [ ] All local imports use extensionless paths
- [ ] No `.js` or `.jsx` extensions in import statements
- [ ] External package imports use package names only
- [ ] Import paths are relative and consistent
- [ ] No circular dependencies

### Automated Checks
Consider adding ESLint rules:
```json
{
  "rules": {
    "import/extensions": ["error", "ignorePackages", {
      "js": "never",
      "jsx": "never"
    }]
  }
}
```

## Common Import Issues

### 1. Mixed Extension Usage
**Problem**: Some files use `.js`, others don't
**Solution**: Standardize on extensionless imports

### 2. Case Sensitivity
**Problem**: Import paths don't match actual file names
**Solution**: Use exact case matching

### 3. Circular Dependencies
**Problem**: File A imports File B, which imports File A
**Solution**: Restructure code to avoid circular imports

### 4. Missing Files
**Problem**: Importing non-existent files
**Solution**: Verify file existence before importing

## Testing Import Changes

### Before Deployment
1. Run `npx expo start --clear` to test with clean cache
2. Check for Metro bundler errors
3. Verify all imports resolve correctly
4. Test on both iOS and Android if applicable

### Error Patterns to Watch For
- "Unable to resolve module" errors
- Metro bundler build failures
- Import resolution conflicts
- Circular dependency warnings

