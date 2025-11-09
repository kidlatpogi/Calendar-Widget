// Lazy loader for home.js - called only when home window is opened
// This achieves code-splitting: home.js (~10KB) loaded only when needed

let homeJsLoaded = false;

function loadHomeScript() {
  if (homeJsLoaded) return Promise.resolve(); // Already loaded
  
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '../JavaScript/home.js';
    script.async = true;
    script.onload = () => {
      homeJsLoaded = true;
  // home.js loaded successfully (silenced)
      resolve();
    };
    script.onerror = (err) => {
  // Failed to load home.js - silenced
      reject(err);
    };
    document.head.appendChild(script);
  });
}

// Hook into the home window's ready event
// The main process will call this when home window is ready
window.initializeHomeWindow = function() {
  if (document.readyState === 'loading') {
    return new Promise((resolve) => {
      document.addEventListener('DOMContentLoaded', () => {
        loadHomeScript().then(resolve).catch((err) => {
          // Error initializing home window - silenced
          resolve(); // Still resolve to avoid blocking
        });
      });
    });
  } else {
    // DOM already loaded
    return loadHomeScript().catch((err) => {
  // Error initializing home window - silenced
      return Promise.resolve(); // Don't throw
    });
  }
};

// Home window lazy loader ready (silenced)
