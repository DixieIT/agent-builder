import { Skeleton } from "@/components/ui/skeleton";

export default function SystemsLoading() {
  return (
    <div className="overflow-hidden rounded-3xl border bg-card" aria-busy="true" aria-label="Loading systems">
      <div className="flex items-center gap-3 border-b px-5 py-3">
        <Skeleton className="h-7 w-32 rounded-full" />
      </div>
      <div className="flex flex-col divide-y">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-5 w-24 rounded-full" />
            <Skeleton className="ml-auto h-4 w-8" />
          </div>
        ))}
      </div>
    </div>
  );
}
