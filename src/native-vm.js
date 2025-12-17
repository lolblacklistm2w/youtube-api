// Browser/React Native compatible script execution
class NativeVM {
    constructor(code) {
        this.code = code;
        this.isDebug = false; // Disable debugging for production
    }
    
    /**
     * Pre-process the code to remove YouTube's short-circuit checks
     * These checks detect non-browser environments and return error values
     */
    preprocessCode(code) {
        return code
            // Pattern 1: if (typeof X === "undefined") return Y;
            .replace(/;\s*if\s*\(\s*typeof\s+[a-zA-Z_$][a-zA-Z0-9_$]*\s*===?\s*(?:"undefined"|'undefined')\s*\)\s*return\s+[a-zA-Z_$][a-zA-Z0-9_$]*\s*;?/gi, ';')
            // Pattern 2: if (typeof X === Y[N]) return Z;
            .replace(/;\s*if\s*\(\s*typeof\s+[a-zA-Z_$][a-zA-Z0-9_$]*\s*===?\s*[a-zA-Z_$][a-zA-Z0-9_$]*\[\d+\]\s*\)\s*return\s+[a-zA-Z_$][a-zA-Z0-9_$]*\s*;?/gi, ';')
            // Pattern 3: Remove enhanced_except checks
            .replace(/;\s*if\s*\([^)]*enhanced_except[^)]*\)\s*return\s+[^;]+;/gi, ';');
    }
    
    runInNewContext(context) {
        if (this.isDebug) {
            console.log('Executing code with context:', Object.keys(context));
            console.log('Code to execute:', this.code.substring(0, 300) + '...');
        }
        
        try {
            // Create execution environment and execute the YouTube code
            const contextKeys = Object.keys(context);
            const contextValues = contextKeys.map(key => context[key]);
            
            // Pre-process code to remove short-circuit checks
            const processedCode = this.preprocessCode(this.code);
            
            // The extracted code defines functions but doesn't call them
            // We need to execute the code and then call the appropriate function
            const wrappedCode = `
                // === SIMULATE BROWSER ENVIRONMENT ===
                // These variables are checked by YouTube's anti-bot code
                var window = (typeof window !== 'undefined') ? window : {
                    location: { href: 'https://www.youtube.com', hostname: 'www.youtube.com', protocol: 'https:' },
                    navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
                };
                var self = (typeof self !== 'undefined') ? self : window;
                var globalThis = (typeof globalThis !== 'undefined') ? globalThis : window;
                var document = (typeof document !== 'undefined') ? document : { 
                    createElement: function(tag) { 
                        return { 
                            style: {}, 
                            appendChild: function() {}, 
                            setAttribute: function() {},
                            getElementsByTagName: function() { return []; }
                        }; 
                    },
                    getElementsByTagName: function() { return []; },
                    getElementById: function() { return null; },
                    body: { appendChild: function() {} },
                    head: { appendChild: function() {} }
                };
                var navigator = (typeof navigator !== 'undefined') ? navigator : { 
                    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    platform: 'Win32',
                    language: 'en-US'
                };
                var location = (typeof location !== 'undefined') ? location : { 
                    href: 'https://www.youtube.com', 
                    hostname: 'www.youtube.com',
                    protocol: 'https:',
                    origin: 'https://www.youtube.com'
                };
                var performance = (typeof performance !== 'undefined') ? performance : { 
                    now: function() { return Date.now(); },
                    timing: { navigationStart: Date.now() }
                };
                var localStorage = (typeof localStorage !== 'undefined') ? localStorage : { 
                    getItem: function() { return null; }, 
                    setItem: function() {},
                    removeItem: function() {}
                };
                var sessionStorage = (typeof sessionStorage !== 'undefined') ? sessionStorage : { 
                    getItem: function() { return null; }, 
                    setItem: function() {},
                    removeItem: function() {}
                };
                var crypto = (typeof crypto !== 'undefined') ? crypto : {
                    getRandomValues: function(arr) { 
                        for (var i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
                        return arr;
                    }
                };
                
                // === SET UP CONTEXT VARIABLES ===
                ${contextKeys.map((key, index) => `var ${key} = arguments[${index}];`).join('\n')}
                
                // === EXECUTE THE EXTRACTED YOUTUBE CODE ===
                ${processedCode}
                
                // === CALL THE APPROPRIATE FUNCTION ===
                ${contextKeys.includes('sig') ? `
                    if (typeof DisTubeDecipherFunc === 'function') {
                        return DisTubeDecipherFunc(sig);
                    }
                ` : ''}
                ${contextKeys.includes('ncode') ? `
                    if (typeof DisTubeNTransformFunc === 'function') {
                        return DisTubeNTransformFunc(ncode);
                    }
                ` : ''}
                
                // Fallback: return null if no appropriate function found
                return null;
            `;
            
            const execFunction = new Function(wrappedCode);
            const result = execFunction.apply(null, contextValues);
            
            if (this.isDebug) {
                console.log('Execution result:', result);
                console.log('Result type:', typeof result);
            }
            
            return result;
            
        } catch (error) {
            console.error('NativeVM execution failed:', error);
            if (this.isDebug) {
                console.error('Context:', context);
            }
            
            // Enhanced fallback with non-strict mode
            try {
                const contextKeys = Object.keys(context);
                const contextValues = contextKeys.map(key => context[key]);
                
                // Pre-process code for fallback too
                const processedCode = this.preprocessCode(this.code);
                
                const fallbackCode = `
                    // Minimal browser simulation for fallback
                    var window = window || {};
                    var self = self || window;
                    var globalThis = globalThis || window;
                    var document = document || { createElement: function() { return {}; } };
                    var navigator = navigator || { userAgent: 'Mozilla/5.0' };
                    var location = location || { href: 'https://www.youtube.com' };
                    
                    ${contextKeys.map((key, index) => `var ${key} = arguments[${index}];`).join('\n')}
                    
                    (function() {
                        ${processedCode}
                        
                        if (typeof DisTubeDecipherFunc === 'function' && typeof sig !== 'undefined') {
                            return DisTubeDecipherFunc(sig);
                        }
                        if (typeof DisTubeNTransformFunc === 'function' && typeof ncode !== 'undefined') {
                            return DisTubeNTransformFunc(ncode);
                        }
                        return null;
                    })()
                `;
                
                const fallbackFunction = new Function(fallbackCode);
                const fallbackResult = fallbackFunction.apply(null, contextValues);
                
                if (this.isDebug) console.log('Fallback result:', fallbackResult);
                return fallbackResult;
                
            } catch (fallbackError) {
                console.error('Fallback execution also failed:', fallbackError);
                return null;
            }
        }
    }
}


export const vm = {
    Script: NativeVM
}

export default NativeVM;
