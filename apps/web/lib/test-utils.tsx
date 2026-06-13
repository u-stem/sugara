import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type RenderOptions, type RenderResult, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement, ReactNode } from "react";
import messages from "../messages/ja.json";

function IntlWrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="ja" messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}

export function renderWithIntl(
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper">,
): RenderResult {
  return render(ui, { wrapper: IntlWrapper, ...options });
}

// Renders under both the intl provider and a fresh, retry-disabled QueryClient.
// Retries are off so a mutation/query that rejects surfaces immediately instead
// of stalling the test behind TanStack Query's default backoff. A new client per
// call keeps each test's cache isolated.
export function renderWithIntlAndQuery(
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper">,
): RenderResult {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <IntlWrapper>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </IntlWrapper>
    );
  }
  return render(ui, { wrapper: Wrapper, ...options });
}
