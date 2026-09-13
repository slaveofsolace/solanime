export interface SourceArchiveOptions {
  includeResearch?: boolean;
  root?: string;
}

export interface BuildSourceArchiveOptions extends SourceArchiveOptions {
  out: string;
}

export function shouldIncludeSourcePath(path: string, options?: SourceArchiveOptions): boolean;
export function listSourcePaths(options?: SourceArchiveOptions): string[];
export function buildSourceArchive(options: BuildSourceArchiveOptions): {
  output: string;
  files: number;
  bytes: number;
  manifest: object;
};
