/** Iconify icon id, brand color, and Tailwind chip classes — shared by ChatInput + MessageThread */

export interface FileTypeDisplay {
  icon: string;
  color: string;
  chip: string;
}

const FILE_ICONS: Record<string, FileTypeDisplay> = {
  py: {
    icon: "devicon:python",
    color: "#3776AB",
    chip: "bg-blue-600/20 border-blue-500/30",
  },
  js: {
    icon: "devicon:javascript",
    color: "#F7DF1E",
    chip: "bg-yellow-600/20 border-yellow-500/30",
  },
  ts: {
    icon: "devicon:typescript",
    color: "#3178C6",
    chip: "bg-blue-600/20 border-blue-500/30",
  },
  java: {
    icon: "devicon:java",
    color: "#5382A1",
    chip: "bg-red-600/20 border-red-500/30",
  },
  c: {
    icon: "devicon:c",
    color: "#555555",
    chip: "bg-gray-600/20 border-gray-500/30",
  },
  cpp: {
    icon: "devicon:cplusplus",
    color: "#9C3320",
    chip: "bg-blue-600/20 border-blue-500/30",
  },
  cs: {
    icon: "devicon:csharp",
    color: "#9B4F96",
    chip: "bg-cyan-600/20 border-cyan-500/30",
  },
  go: {
    icon: "devicon:go",
    color: "#3740CC",
    chip: "bg-cyan-600/20 border-cyan-500/30",
  },
  rs: {
    icon: "devicon:rust",
    color: "#DEA584",
    chip: "bg-orange-600/20 border-orange-500/30",
  },
  rb: {
    icon: "devicon:ruby",
    color: "#CC342D",
    chip: "bg-red-600/20 border-red-500/30",
  },
  php: {
    icon: "devicon:php",
    color: "#777BB4",
    chip: "bg-indigo-600/20 border-indigo-500/30",
  },
  swift: {
    icon: "devicon:swift",
    color: "#F05138",
    chip: "bg-orange-600/20 border-orange-500/30",
  },
  kt: {
    icon: "devicon:kotlin",
    color: "#A97BFF",
    chip: "bg-cyan-600/20 border-cyan-500/30",
  },
  scala: {
    icon: "devicon:scala",
    color: "#DC322F",
    chip: "bg-red-600/20 border-red-500/30",
  },
  r: {
    icon: "devicon:r",
    color: "#276DC3",
    chip: "bg-blue-600/20 border-blue-500/30",
  },
  perl: {
    icon: "devicon:perl",
    color: "#019833",
    chip: "bg-green-600/20 border-green-500/30",
  },
  lua: {
    icon: "devicon:lua",
    color: "#000080",
    chip: "bg-blue-600/20 border-blue-500/30",
  },
  html: {
    icon: "devicon:html5",
    color: "#E34F26",
    chip: "bg-orange-600/20 border-orange-500/30",
  },
  htm: {
    icon: "devicon:html5",
    color: "#E34F26",
    chip: "bg-orange-600/20 border-orange-500/30",
  },
  css: {
    icon: "devicon:css3",
    color: "#264DE4",
    chip: "bg-blue-600/20 border-blue-500/30",
  },
  jsx: {
    icon: "devicon:react",
    color: "#61DAFB",
    chip: "bg-cyan-600/20 border-cyan-500/30",
  },
  tsx: {
    icon: "devicon:react",
    color: "#61DAFB",
    chip: "bg-blue-600/20 border-blue-500/30",
  },
  vue: {
    icon: "devicon:vue",
    color: "#41B883",
    chip: "bg-green-600/20 border-green-500/30",
  },
  svelte: {
    icon: "devicon:svelte",
    color: "#FF3E00",
    chip: "bg-red-600/20 border-red-500/30",
  },
  json: {
    icon: "devicon:json",
    color: "#2C2C2C",
    chip: "bg-amber-600/20 border-amber-500/30",
  },
  xml: {
    icon: "devicon:xml",
    color: "#005F92",
    chip: "bg-orange-600/20 border-orange-500/30",
  },
  yaml: {
    icon: "devicon:yaml",
    color: "#CB171E",
    chip: "bg-red-600/20 border-red-500/30",
  },
  yml: {
    icon: "devicon:yaml",
    color: "#CB171E",
    chip: "bg-red-600/20 border-red-500/30",
  },
  csv: {
    icon: "devicon:csv",
    color: "#2C7529",
    chip: "bg-green-600/20 border-green-500/30",
  },
  sql: {
    icon: "devicon:mysql",
    color: "#4479A1",
    chip: "bg-blue-600/20 border-blue-500/30",
  },
  db: {
    icon: "devicon:sqlite",
    color: "#003B57",
    chip: "bg-blue-600/20 border-blue-500/30",
  },
  md: {
    icon: "devicon:markdown",
    color: "#000000",
    chip: "bg-zinc-600/20 border-zinc-500/30",
  },
  markdown: {
    icon: "devicon:markdown",
    color: "#000000",
    chip: "bg-zinc-600/20 border-zinc-500/30",
  },
  txt: {
    icon: "devicon:txt",
    color: "#000080",
    chip: "bg-zinc-600/20 border-zinc-500/30",
  },
  pdf: {
    icon: "devicon:adobe-acrobat",
    color: "#E30613",
    chip: "bg-red-600/20 border-red-500/30",
  },
  doc: {
    icon: "devicon:microsoft-word",
    color: "#1B5E20",
    chip: "bg-blue-600/20 border-blue-500/30",
  },
  docx: {
    icon: "devicon:microsoft-word",
    color: "#1B5E20",
    chip: "bg-blue-600/20 border-blue-500/30",
  },
  xls: {
    icon: "devicon:microsoft-excel",
    color: "#1B5E20",
    chip: "bg-green-600/20 border-green-500/30",
  },
  xlsx: {
    icon: "devicon:microsoft-excel",
    color: "#1B5E20",
    chip: "bg-green-600/20 border-green-500/30",
  },
  ppt: {
    icon: "devicon:microsoft-powerpoint",
    color: "#D24726",
    chip: "bg-orange-600/20 border-orange-500/30",
  },
  pptx: {
    icon: "devicon:microsoft-powerpoint",
    color: "#D24726",
    chip: "bg-orange-600/20 border-orange-500/30",
  },
  zip: {
    icon: "devicon:zip",
    color: "#F05032",
    chip: "bg-orange-600/20 border-orange-500/30",
  },
  tar: {
    icon: "devicon:tar",
    color: "#E93443",
    chip: "bg-red-600/20 border-red-500/30",
  },
  gz: {
    icon: "devicon:gzip",
    color: "#F05032",
    chip: "bg-orange-600/20 border-orange-500/30",
  },
  "7z": {
    icon: "devicon:7zip",
    color: "#2C7529",
    chip: "bg-green-600/20 border-green-500/30",
  },
  rar: {
    icon: "devicon:winrar",
    color: "#0F2B46",
    chip: "bg-blue-600/20 border-blue-500/30",
  },
  toml: {
    icon: "devicon:toml",
    color: "#9C4221",
    chip: "bg-orange-600/20 border-orange-500/30",
  },
  ini: {
    icon: "devicon:ini",
    color: "#69962E",
    chip: "bg-green-600/20 border-green-500/30",
  },
  env: {
    icon: "devicon:dotenv",
    color: "#EA580C",
    chip: "bg-orange-600/20 border-orange-500/30",
  },
  sh: {
    icon: "devicon:bash",
    color: "#4EAA25",
    chip: "bg-green-600/20 border-green-500/30",
  },
  bash: {
    icon: "devicon:bash",
    color: "#4EAA25",
    chip: "bg-green-600/20 border-green-500/30",
  },
  zsh: {
    icon: "devicon:zsh",
    color: "#000000",
    chip: "bg-zinc-600/20 border-zinc-500/30",
  },
  fish: {
    icon: "devicon:fish",
    color: "#005C9F",
    chip: "bg-blue-600/20 border-blue-500/30",
  },
  ps1: {
    icon: "devicon:powershell",
    color: "#012456",
    chip: "bg-cyan-600/20 border-cyan-500/30",
  },
  bat: {
    icon: "devicon:windows",
    color: "#00A4EF",
    chip: "bg-blue-600/20 border-blue-500/30",
  },
  log: {
    icon: "devicon:log",
    color: "#FF8C00",
    chip: "bg-amber-600/20 border-amber-500/30",
  },
  gitignore: {
    icon: "devicon:git",
    color: "#F05032",
    chip: "bg-red-600/20 border-red-500/30",
  },
  dockerfile: {
    icon: "devicon:docker",
    color: "#2496ED",
    chip: "bg-blue-600/20 border-blue-500/30",
  },
  "docker-compose.yml": {
    icon: "devicon:docker",
    color: "#2496ED",
    chip: "bg-blue-600/20 border-blue-500/30",
  },
  graphql: {
    icon: "devicon:graphql",
    color: "#E10098",
    chip: "bg-pink-600/20 border-pink-500/30",
  },
  gql: {
    icon: "devicon:graphql",
    color: "#E10098",
    chip: "bg-pink-600/20 border-pink-500/30",
  },
  proto: {
    icon: "devicon:protocolbuffers",
    color: "#4285F4",
    chip: "bg-blue-600/20 border-blue-500/30",
  },
  svg: {
    icon: "devicon:svg",
    color: "#FFB13B",
    chip: "bg-orange-600/20 border-orange-500/30",
  },
  mp3: {
    icon: "devicon:mp3",
    color: "#FF8C00",
    chip: "bg-amber-600/20 border-amber-500/30",
  },
  mp4: {
    icon: "devicon:mp4",
    color: "#E50914",
    chip: "bg-red-600/20 border-red-500/30",
  },
  avi: {
    icon: "devicon:avi",
    color: "#FF8C00",
    chip: "bg-orange-600/20 border-orange-500/30",
  },
  mkv: {
    icon: "devicon:mkv",
    color: "#F5C518",
    chip: "bg-yellow-600/20 border-yellow-500/30",
  },
  wav: {
    icon: "devicon:wav",
    color: "#4169E1",
    chip: "bg-blue-600/20 border-blue-500/30",
  },
  flac: {
    icon: "devicon:flac",
    color: "#4A90E2",
    chip: "bg-blue-600/20 border-blue-500/30",
  },
};

export function getFileTypeInfo(filename: string): FileTypeDisplay {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const fileTypeInfo = FILE_ICONS[ext];

  if (fileTypeInfo) {
    return fileTypeInfo;
  }

  if (filename.toLowerCase().endsWith(".dockerfile")) {
    return FILE_ICONS.dockerfile;
  }

  if (
    filename.toLowerCase() === "docker-compose.yml" ||
    filename.toLowerCase() === "docker-compose.yaml"
  ) {
    return FILE_ICONS["docker-compose.yml"];
  }

  if (filename.toLowerCase() === ".gitignore") {
    return FILE_ICONS.gitignore;
  }

  return {
    icon: "",
    color: "#9CA3AF",
    chip: "bg-zinc-700/60 border-zinc-600/50",
  };
}
