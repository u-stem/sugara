import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { ApiError } from "@/lib/api";
import { clearClientCache } from "@/lib/sign-out";

/**
 * Redirect to login page when a query fails with 401.
 * Uses a ref guard to prevent multiple redirects from concurrent errors.
 */
export function useAuthRedirect(error: Error | null) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const redirected = useRef(false);

  useEffect(() => {
    if (error instanceof ApiError && error.status === 401 && !redirected.current) {
      redirected.current = true;
      // The session is gone but nobody signed out explicitly; wipe the data it left on
      // this device before the login page (and /offline) can expose it.
      void clearClientCache(queryClient).finally(() => router.push("/auth/login"));
    }
  }, [error, router, queryClient]);
}
