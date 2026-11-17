import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="overflow-hidden rounded-3xl border bg-card">
      <div className="flex items-center gap-3 border-b px-5 py-3">
        <Skeleton className="h-7 w-56 rounded-full" />
        <Skeleton className="ml-auto size-9 rounded-full" />
      </div>
      <div className="flex flex-col divide-y">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-3">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-5 w-24 rounded-full" />
            <Skeleton className="ml-auto h-4 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}
