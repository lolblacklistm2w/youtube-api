import { vm } from './native-vm.js';
const cache = new Map();
import querystring from 'querystring';
import { request } from './requrest.js';

export const getFunctions = (functionsKey, body) => {
    const cached = cache.get(functionsKey);
    if (cached) {
        return cached;
    }
    
    const functions = extractFunctions(body);
    cache.set(functionsKey, functions);
    return functions;
};

const DECIPHER_ARGUMENT = "sig";
const N_ARGUMENT = "ncode";
const DECIPHER_FUNC_NAME = "DisTubeDecipherFunc";
const N_TRANSFORM_FUNC_NAME = "DisTubeNTransformFunc";

/**
 * Find a variable declaration that contains a specific string
 * Used to find the TCE global variable array
 */
const findVariableByContent = (body, searchStrings) => {
    for (const search of searchStrings) {
        // Look for var X = "..." pattern containing the search string
        const varPattern = new RegExp(
            `var\\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*=\\s*([\\["\'][^;]{0,5000}${search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^;]{0,5000});`,
            's'
        );
        const match = body.match(varPattern);
        if (match) {
            return {
                name: match[1],
                code: `var ${match[1]} = ${match[2]};`
            };
        }
    }
    return null;
};

/**
 * Find a function that contains specific content
 * Returns the function code and its name
 */
const findFunctionByContent = (body, searchStrings) => {
    for (const search of searchStrings) {
        const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        
        // Method 1: Named function - function name(a) { ... search ... }
        const namedFuncPattern = new RegExp(
            `(function\\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*\\([^)]*\\)\\s*\\{[^{}]*(?:\\{[^{}]*(?:\\{[^{}]*\\}[^{}]*)*\\}[^{}]*)*${escapedSearch}[^{}]*(?:\\{[^{}]*(?:\\{[^{}]*\\}[^{}]*)*\\}[^{}]*)*\\})`,
            's'
        );
        let match = body.match(namedFuncPattern);
        if (match) {
            return {
                name: match[2],
                code: match[1]
            };
        }

        // Method 2: Variable assignment - var name = function(a) { ... search ... }
        const varFuncPattern = new RegExp(
            `(var\\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*=\\s*function\\s*\\([^)]*\\)\\s*\\{[^{}]*(?:\\{[^{}]*(?:\\{[^{}]*\\}[^{}]*)*\\}[^{}]*)*${escapedSearch}[^{}]*(?:\\{[^{}]*(?:\\{[^{}]*\\}[^{}]*)*\\}[^{}]*)*\\})`,
            's'
        );
        match = body.match(varFuncPattern);
        if (match) {
            return {
                name: match[2],
                code: match[1]
            };
        }

        // Method 3: Look for the function containing the search string with simpler pattern
        const idx = body.indexOf(search);
        if (idx !== -1) {
            // Find the function start before this index
            let funcStart = -1;
            let braceDepth = 0;
            let i = idx;
            
            // Go backwards to find function start
            while (i > 0 && funcStart === -1) {
                if (body[i] === '}') braceDepth++;
                if (body[i] === '{') {
                    braceDepth--;
                    if (braceDepth < 0) {
                        // Found matching open brace, look for function before it
                        const before = body.substring(Math.max(0, i - 100), i);
                        const funcMatch = before.match(/(function\s*([a-zA-Z_$][a-zA-Z0-9_$]*)?)\s*\([^)]*\)\s*$/);
                        if (funcMatch) {
                            funcStart = i - before.length + before.indexOf(funcMatch[1]);
                        }
                        break;
                    }
                }
                i--;
            }
            
            if (funcStart !== -1) {
                // Find the function end
                braceDepth = 0;
                let funcEnd = -1;
                for (let j = funcStart; j < body.length && funcEnd === -1; j++) {
                    if (body[j] === '{') braceDepth++;
                    if (body[j] === '}') {
                        braceDepth--;
                        if (braceDepth === 0) {
                            funcEnd = j + 1;
                        }
                    }
                }
                
                if (funcEnd !== -1) {
                    const funcCode = body.substring(funcStart, funcEnd);
                    const nameMatch = funcCode.match(/function\s*([a-zA-Z_$][a-zA-Z0-9_$]*)?/);
                    return {
                        name: nameMatch?.[1] || 'anonymous',
                        code: funcCode
                    };
                }
            }
        }
    }
    return null;
};

/**
 * Extract the signature decipher function using the split/join pattern
 */
const extractSigDecipherFunc = (body, globalVar) => {
    // Pattern: function(a){a=a.split("");...helper...;return a.join("")}
    const sigPattern = /function\(([a-zA-Z_$][a-zA-Z0-9_$]*)\)\{(\1=\1\.split\((?:""|[a-zA-Z_$][a-zA-Z0-9_$]*\[\d+\])\)(.+?)\.join\((?:""|[a-zA-Z_$][a-zA-Z0-9_$]*\[\d+\])\))\}/;
    const match = body.match(sigPattern);
    
    if (!match) {
        return null;
    }
    
    const varName = match[1];
    const funcBody = match[2];
    
    // Extract the helper object name from the function body
    // It's the object being called like: helperObj.functionName(a, N)
    const helperCallMatch = match[3].match(/([a-zA-Z_$][a-zA-Z0-9_$]*)(?:\.|(?:\["))[a-zA-Z_$][a-zA-Z0-9_$]*(?:"\])?/);
    
    if (!helperCallMatch) {
        return null;
    }
    
    const helperObjName = helperCallMatch[1];
    
    // Find the helper object definition
    const helperPattern = new RegExp(
        `var\\s+${helperObjName.replace(/[$]/g, '\\$')}\\s*=\\s*\\{([^}]+(?:\\{[^}]*\\}[^}]*)*)\\}`,
        's'
    );
    const helperMatch = body.match(helperPattern);
    
    if (!helperMatch) {
        return null;
    }
    
    const helperCode = `var ${helperObjName}={${helperMatch[1]}}`;
    
    // Build the final decipher function
    const globalVarCode = globalVar?.code || '';
    const decipherFunc = `function ${DECIPHER_FUNC_NAME}(${varName}){${funcBody}}`;
    
    return `${globalVarCode}\n${helperCode};\n${decipherFunc}\n${DECIPHER_FUNC_NAME}(${DECIPHER_ARGUMENT});`;
};

/**
 * Remove short-circuit checks that detect non-browser environments
 */
const removeShortCircuits = (code) => {
    return code
        // Pattern 1: if (typeof X === "undefined") return Y;
        .replace(/;\s*if\s*\(\s*typeof\s+[a-zA-Z_$][a-zA-Z0-9_$]*\s*===?\s*["']undefined["']\s*\)\s*return\s+[a-zA-Z_$][a-zA-Z0-9_$]*\s*;?/gi, ';')
        // Pattern 2: if (typeof X === Y[N]) return Z;
        .replace(/;\s*if\s*\(\s*typeof\s+[a-zA-Z_$][a-zA-Z0-9_$]*\s*===?\s*[a-zA-Z_$][a-zA-Z0-9_$]*\[\d+\]\s*\)\s*return\s+[a-zA-Z_$][a-zA-Z0-9_$]*\s*;?/gi, ';')
        // Pattern 3: if (typeof X === void 0) return Y;
        .replace(/;\s*if\s*\(\s*typeof\s+[a-zA-Z_$][a-zA-Z0-9_$]*\s*===?\s*void\s+0\s*\)\s*return\s+[a-zA-Z_$][a-zA-Z0-9_$]*\s*;?/gi, ';')
        // Pattern 4: Specific to enhanced_except
        .replace(/;\s*if\s*\([^)]*enhanced_except[^)]*\)\s*return\s+[^;]+;/gi, ';');
};

/**
 * Extract the N transform function by searching for known content patterns
 */
const extractNTransformFunc = (body, globalVar) => {
    // Search strings that are typically found in the N transform function
    const searchStrings = [
        '-_w8_',           // Error tag suffix
        '1969-12-31',      // Magic date
        '1970-01-01',      // Magic date  
        'enhanced_except', // Error prefix
        '.push(String.fromCharCode(',  // String building
        '.reverse().forEach(function', // Array manipulation
        'new Date('        // Date construction
    ];
    
    const funcResult = findFunctionByContent(body, searchStrings);
    
    if (!funcResult) {
        return null;
    }
    
    // Clean the function code by removing short-circuits
    let cleanedCode = removeShortCircuits(funcResult.code);
    
    // Build the final N transform function
    const globalVarCode = globalVar?.code || '';
    
    // Wrap the function with our expected name
    if (funcResult.name && funcResult.name !== 'anonymous') {
        return `${globalVarCode}\n${cleanedCode}\nvar ${N_TRANSFORM_FUNC_NAME}=${funcResult.name};\n${N_TRANSFORM_FUNC_NAME}(${N_ARGUMENT});`;
    } else {
        // Anonymous function - wrap it
        cleanedCode = cleanedCode.replace(/^function\s*\(/, `function ${N_TRANSFORM_FUNC_NAME}(`);
        return `${globalVarCode}\n${cleanedCode}\n${N_TRANSFORM_FUNC_NAME}(${N_ARGUMENT});`;
    }
};

/**
 * Extract the global TCE variable (contains string array used for obfuscation)
 */
const extractGlobalVariable = (body) => {
    // These strings are typically found in the TCE global variable
    const searchStrings = [
        '-_w8_',
        'Untrusted URL{',
        '1969',
        '1970',
        'playerfallback'
    ];
    
    return findVariableByContent(body, searchStrings);
};

let decipherWarning = false;
let nTransformWarning = false;

export const extractFunctions = body => {
    if (!body) {
        return [null, null];
    }
    
    // Extract the global variable first
    const globalVar = extractGlobalVariable(body);
    
    // Extract decipher function
    let decipherScript = null;
    try {
        const decipherCode = extractSigDecipherFunc(body, globalVar);
        if (decipherCode) {
            decipherScript = new vm.Script(decipherCode);
        }
    } catch (err) {
        console.error("Failed to extract decipher function:", err);
    }
    
    if (!decipherScript && !decipherWarning) {
        console.warn(
            "\x1b[33mWARNING:\x1B[0m Could not parse decipher function.\n" +
            "Stream URLs will be missing."
        );
        decipherWarning = true;
    }
    
    // Extract N transform function
    let nTransformScript = null;
    try {
        const nTransformCode = extractNTransformFunc(body, globalVar);
        if (nTransformCode) {
            nTransformScript = new vm.Script(nTransformCode);
        }
    } catch (err) {
        console.error("Failed to extract n transform function:", err);
    }
    
    if (!nTransformScript && !nTransformWarning) {
        console.warn(
            "\x1b[33mWARNING:\x1B[0m Could not parse n transform function."
        );
        nTransformWarning = true;
    }
    
    return [decipherScript, nTransformScript];
};

export const setDownloadURL = (format, decipherScript, nTransformScript) => {
    if (!format) return;

    const decipher = url => {
        const args = querystring.parse(url);
        if (!args.s || !decipherScript) return args.url;

        try {
            const components = new URL(decodeURIComponent(args.url));
            const context = {};
            context[DECIPHER_ARGUMENT] = decodeURIComponent(args.s);
            const decipheredSig = decipherScript.runInNewContext(context);

            components.searchParams.set(args.sp || "sig", decipheredSig);
            return components.toString();
        } catch (err) {
            console.error("Error applying decipher:", err);
            return args.url;
        }
    };

    const nTransform = url => {
        try {
            const components = new URL(decodeURIComponent(url));
            const n = components.searchParams.get("n");

            if (!n || !nTransformScript) return url;

            const context = {};
            context[N_ARGUMENT] = n;
            const transformedN = nTransformScript.runInNewContext(context);

            if (transformedN && typeof transformedN === 'string') {
                if (n === transformedN) {
                    console.warn("Transformed n parameter is the same as input, n function possibly short-circuited");
                } else if (transformedN.startsWith("enhanced_except_") || transformedN.includes("_w8_")) {
                    console.warn("N function did not complete due to exception");
                }

                components.searchParams.set("n", transformedN);
            } else if (transformedN) {
                // Try to convert to string if it's not already
                const nStr = String(transformedN);
                if (nStr && nStr !== 'undefined' && nStr !== 'null') {
                    components.searchParams.set("n", nStr);
                }
            }

            return components.toString();
        } catch (err) {
            console.error("Error applying n transform:", err);
            return url;
        }
    };

    const cipher = !format.url;
    const url = format.url || format.signatureCipher || format.cipher;

    if (!url) return;

    try {
        format.url = nTransform(cipher ? decipher(url) : url);

        delete format.signatureCipher;
        delete format.cipher;
    } catch (err) {
        console.error("Error setting download URL:", err);
    }
};

export const decipherFormats = async (formats, html5player, options) => {
    try {
        const decipheredFormats = {};
        const functionsKey = `functions-${html5player}`;

        let body;

        if (!cache.has(functionsKey)) {
            body = await request(html5player, options);
        }
        
        const [decipherScript, nTransformScript] = await getFunctions(functionsKey, body);

        formats.forEach(format => {
            setDownloadURL(format, decipherScript, nTransformScript);
            if (format.url) {
                decipheredFormats[format.url] = format;
            }
        });

        return decipheredFormats;
    } catch (err) {
        console.error("Error deciphering formats:", err);
        return {};
    }
};
