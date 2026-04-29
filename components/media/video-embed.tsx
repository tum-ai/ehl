import { cn } from "@/lib/utils";

interface VideoEmbedProps {
  url: string;
  title: string;
  className?: string;
}

export function VideoEmbed({ url, title, className }: VideoEmbedProps) {
  return (
    <div
      className={cn(
        "aspect-video overflow-hidden rounded-xl border border-white/10",
        className
      )}
    >
      <iframe
        src={url}
        title={title}
        className="h-full w-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        loading="lazy"
      />
    </div>
  );
}
