import { Skeleton } from "@/components/ui/skeleton";

export default function SystemLoading() {
  return (
    <div className="overflow-hidden rounded-3xl border bg-card" aria-busy="true" aria-label="Loading system">
      <div className="flex items-center gap-3 border-b px-5 py-3">
        <Skeleton className="h-7 w-56 rounded-full" />
        <Skeleton className="h-5 w-20 rounded-full" />
      </div>
      <div className="border-b px-5 py-2">
        <Skeleton className="h-8 w-56 rounded-lg" />
      </div>
      <div className="m-5 flex flex-col divide-y rounded-2xl border bg-background/50">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-2.5">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
