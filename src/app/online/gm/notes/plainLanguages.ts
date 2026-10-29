/** Code fence languages whose blocks players may see; any other language (dataview, mermaid, a plugin's) is hidden. */
export const PLAIN_CODE_LANGUAGES: ReadonlySet<string> = new Set([
	'none', 'text', 'txt', 'plain', 'js', 'javascript', 'jsx', 'ts', 'typescript', 'tsx', 'json', 'yaml', 'yml', 'toml', 'ini',
	'sh', 'bash', 'zsh', 'shell', 'console', 'powershell', 'ps1', 'bat', 'python', 'py', 'ruby', 'rb', 'go', 'rust', 'rs', 'c',
	'cpp', 'h', 'hpp', 'cs', 'csharp', 'java', 'kotlin', 'swift', 'php', 'sql', 'html', 'css', 'scss', 'xml', 'markdown', 'md',
	'diff', 'lua', 'r', 'perl', 'haskell', 'elixir', 'erlang', 'clojure', 'scala', 'dart', 'verilog', 'systemverilog', 'vhdl',
	'tcl', 'makefile', 'dockerfile', 'latex', 'tex',
]);
