import { Skeleton } from "@/components/ui/skeleton";

export default function ProjectsLoading() {
  return (
    <div className="overflow-hidden rounded-3xl border bg-card" aria-busy="true" aria-label="Loading project">
      <div className="flex items-center gap-3 border-b px-5 py-3">
        <Skeleton className="h-7 w-40 rounded-full" />
      </div>
      <div className="border-b px-5 py-2">
        <Skeleton className="h-8 w-64 rounded-lg" />
      </div>
      <div className="flex flex-col divide-y p-5">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 px-1 py-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="ml-auto h-4 w-8" />
          </div>
        ))}
      </div>
    </div>
  );
}
