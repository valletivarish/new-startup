import { Skeleton } from '@/components/ui/skeleton';

/*
  The auth card while the page reads its link (the Suspense fallback of sign in and reset):
  a title, a line, two fields and the button, in the form's own geometry so nothing jumps.
  Like the app's skeletons it fades in after 300ms, so a quick load never shows it, and
  screen readers hear "Loading" instead.
*/
export function AuthSkeleton() {
  return (
    <div>
      <div aria-busy="true" aria-hidden className="animate-[fade-in_var(--dur-base)_var(--ease-out)_300ms_both]">
        <div className="flex h-[2.125rem] items-center">
          <Skeleton className="h-7 w-40 rounded-pill" />
        </div>
        <div className="mt-2 flex h-5 items-center">
          <Skeleton className="h-3 w-56 max-w-full rounded-pill" />
        </div>
        <div className="mt-6 grid gap-4">
          {[0, 1].map((field) => (
            <div key={field} className="grid gap-1.5">
              <div className="flex h-5 items-center">
                <Skeleton className="h-3 w-16 rounded-pill" />
              </div>
              <Skeleton className="h-11" />
            </div>
          ))}
          <Skeleton className="mt-1 h-12 rounded-button" />
        </div>
      </div>
      <p role="status" className="sr-only">
        Loading
      </p>
    </div>
  );
}
