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
      console.log('[home-init] home.js loaded successfully');
      resolve();
    };
    script.onerror = (err) => {
      console.error('[home-init] Failed to load home.js:', err);
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
          console.error('[home-init] Error initializing home window:', err);
          resolve(); // Still resolve to avoid blocking
        });
      });
    });
  } else {
    // DOM already loaded
    return loadHomeScript().catch((err) => {
      console.error('[home-init] Error initializing home window:', err);
      return Promise.resolve(); // Don't throw
    });
  }
};

console.log('[home-init] Home window lazy loader ready');
