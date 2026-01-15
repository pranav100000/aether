import { basename, extname } from "pathe";
import type { IconType } from "react-icons";
import {
  DiJavascript1,
  DiPython,
  DiRust,
  DiGo,
  DiJava,
  DiHtml5,
  DiCss3,
  DiReact,
  DiMarkdown,
  DiDocker,
  DiRuby,
  DiPhp,
  DiSwift,
} from "react-icons/di";
import {
  SiTypescript,
  SiCplusplus,
  SiC,
  SiJson,
  SiYaml,
  SiToml,
  SiGraphql,
  SiSvelte,
  SiVuedotjs,
  SiKotlin,
  SiLua,
  SiZig,
  SiElixir,
  SiHaskell,
  SiOcaml,
  SiScala,
  SiClojure,
  SiPerl,
  SiDart,
  SiNim,
  SiGnubash,
} from "react-icons/si";
import { TbFileTypeXml } from "react-icons/tb";
import { VscFile, VscFileCode, VscTerminalPowershell } from "react-icons/vsc";

export interface FileIconConfig {
  icon: IconType;
  color: string;
}

// Extension to icon mapping
export const FILE_ICON_MAP: Record<string, FileIconConfig> = {
  // JavaScript family
  js: { icon: DiJavascript1, color: "text-yellow-400" },
  mjs: { icon: DiJavascript1, color: "text-yellow-400" },
  cjs: { icon: DiJavascript1, color: "text-yellow-400" },
  jsx: { icon: DiReact, color: "text-cyan-400" },

  // TypeScript family
  ts: { icon: SiTypescript, color: "text-blue-400" },
  mts: { icon: SiTypescript, color: "text-blue-400" },
  cts: { icon: SiTypescript, color: "text-blue-400" },
  tsx: { icon: DiReact, color: "text-blue-500" },

  // Python
  py: { icon: DiPython, color: "text-green-400" },
  pyw: { icon: DiPython, color: "text-green-400" },
  pyi: { icon: DiPython, color: "text-green-400" },
  pyx: { icon: DiPython, color: "text-green-400" },

  // Systems languages
  rs: { icon: DiRust, color: "text-orange-400" },
  go: { icon: DiGo, color: "text-cyan-300" },
  c: { icon: SiC, color: "text-blue-300" },
  cpp: { icon: SiCplusplus, color: "text-blue-400" },
  cc: { icon: SiCplusplus, color: "text-blue-400" },
  cxx: { icon: SiCplusplus, color: "text-blue-400" },
  h: { icon: SiC, color: "text-purple-300" },
  hpp: { icon: SiCplusplus, color: "text-purple-400" },
  hxx: { icon: SiCplusplus, color: "text-purple-400" },
  zig: { icon: SiZig, color: "text-orange-400" },
  asm: { icon: VscFileCode, color: "text-gray-400" },
  s: { icon: VscFileCode, color: "text-gray-400" },

  // JVM languages
  java: { icon: DiJava, color: "text-red-400" },
  kt: { icon: SiKotlin, color: "text-purple-400" },
  kts: { icon: SiKotlin, color: "text-purple-400" },
  scala: { icon: SiScala, color: "text-red-500" },
  clj: { icon: SiClojure, color: "text-green-500" },
  cljs: { icon: SiClojure, color: "text-green-500" },

  // Web
  html: { icon: DiHtml5, color: "text-orange-400" },
  htm: { icon: DiHtml5, color: "text-orange-400" },
  css: { icon: DiCss3, color: "text-blue-400" },
  scss: { icon: DiCss3, color: "text-pink-400" },
  sass: { icon: DiCss3, color: "text-pink-400" },
  less: { icon: DiCss3, color: "text-purple-400" },
  svelte: { icon: SiSvelte, color: "text-orange-500" },
  vue: { icon: SiVuedotjs, color: "text-green-500" },

  // Data formats
  json: { icon: SiJson, color: "text-yellow-300" },
  yaml: { icon: SiYaml, color: "text-pink-400" },
  yml: { icon: SiYaml, color: "text-pink-400" },
  toml: { icon: SiToml, color: "text-orange-300" },
  xml: { icon: TbFileTypeXml, color: "text-orange-400" },
  graphql: { icon: SiGraphql, color: "text-pink-500" },
  gql: { icon: SiGraphql, color: "text-pink-500" },

  // Documentation
  md: { icon: DiMarkdown, color: "text-gray-400" },
  markdown: { icon: DiMarkdown, color: "text-gray-400" },
  mdx: { icon: DiMarkdown, color: "text-yellow-400" },

  // Scripting languages
  rb: { icon: DiRuby, color: "text-red-500" },
  php: { icon: DiPhp, color: "text-indigo-400" },
  pl: { icon: SiPerl, color: "text-blue-400" },
  pm: { icon: SiPerl, color: "text-blue-400" },
  lua: { icon: SiLua, color: "text-blue-500" },
  sh: { icon: SiGnubash, color: "text-green-400" },
  bash: { icon: SiGnubash, color: "text-green-400" },
  zsh: { icon: SiGnubash, color: "text-green-400" },
  fish: { icon: SiGnubash, color: "text-green-400" },
  ps1: { icon: VscTerminalPowershell, color: "text-blue-400" },
  psm1: { icon: VscTerminalPowershell, color: "text-blue-400" },

  // Mobile
  swift: { icon: DiSwift, color: "text-orange-500" },
  dart: { icon: SiDart, color: "text-blue-400" },

  // Functional languages
  ex: { icon: SiElixir, color: "text-purple-500" },
  exs: { icon: SiElixir, color: "text-purple-500" },
  hs: { icon: SiHaskell, color: "text-purple-400" },
  ml: { icon: SiOcaml, color: "text-orange-400" },
  mli: { icon: SiOcaml, color: "text-orange-400" },
  nim: { icon: SiNim, color: "text-yellow-400" },
};

// Filename-based mappings (for files without extensions or special names)
export const FILENAME_ICON_MAP: Record<string, FileIconConfig> = {
  Dockerfile: { icon: DiDocker, color: "text-blue-400" },
  dockerfile: { icon: DiDocker, color: "text-blue-400" },
  "docker-compose.yml": { icon: DiDocker, color: "text-blue-400" },
  "docker-compose.yaml": { icon: DiDocker, color: "text-blue-400" },
  Makefile: { icon: VscFileCode, color: "text-orange-400" },
  makefile: { icon: VscFileCode, color: "text-orange-400" },
  Rakefile: { icon: DiRuby, color: "text-red-500" },
  Gemfile: { icon: DiRuby, color: "text-red-500" },
  "Cargo.toml": { icon: DiRust, color: "text-orange-400" },
  "Cargo.lock": { icon: DiRust, color: "text-orange-400" },
  "go.mod": { icon: DiGo, color: "text-cyan-300" },
  "go.sum": { icon: DiGo, color: "text-cyan-300" },
  "package.json": { icon: SiJson, color: "text-green-400" },
  "tsconfig.json": { icon: SiTypescript, color: "text-blue-400" },
  "pyproject.toml": { icon: DiPython, color: "text-green-400" },
  "requirements.txt": { icon: DiPython, color: "text-green-400" },
};

// Default fallback icon
export const DEFAULT_FILE_ICON: FileIconConfig = {
  icon: VscFile,
  color: "text-gray-400",
};

export function getFileIconConfig(pathOrName: string): FileIconConfig {
  const fileName = basename(pathOrName);
  const ext = extname(pathOrName).slice(1).toLowerCase(); // Remove leading dot

  // Check filename-based mappings first (for special files like Dockerfile)
  if (FILENAME_ICON_MAP[fileName]) {
    return FILENAME_ICON_MAP[fileName];
  }

  // Then check extension-based mappings
  if (ext && FILE_ICON_MAP[ext]) {
    return FILE_ICON_MAP[ext];
  }

  return DEFAULT_FILE_ICON;
}
