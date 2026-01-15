import { cn } from "@/lib/utils";
import { getFileIconConfig } from "@/lib/file-icons";

export type FileIconSize = "xs" | "sm" | "md" | "lg";

interface FileIconProps {
  path: string;
  size?: FileIconSize;
  className?: string;
  colorClassName?: string;
}

const sizeClasses: Record<FileIconSize, string> = {
  xs: "size-3",
  sm: "size-3.5",
  md: "size-4",
  lg: "size-5",
};

export function FileIcon({ path, size = "md", className, colorClassName }: FileIconProps) {
  const config = getFileIconConfig(path);
  const IconComponent = config.icon;

  return (
    <IconComponent
      className={cn(sizeClasses[size], colorClassName ?? config.color, "shrink-0", className)}
    />
  );
}
