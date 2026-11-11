import { ErrorNotice, LoadingMessage, useQuery } from '@mado/design-system/react';
import { useMemo } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { api } from './api/client';
import { text } from './i18n/catalog';
import { AppShell } from './layout/AppShell';
import { IngestPage } from './pages/IngestPage';
import { LoginPage } from './pages/LoginPage';
import { SearchPage } from './pages/SearchPage';
import type { SessionResponse } from '@mds/contracts';

function createRouter(session: SessionResponse) {
  return createBrowserRouter([
    {
      element: <AppShell session={session} />,
      children: [
        { path: '/', element: <SearchPage /> },
        { path: '/ingest', element: <IngestPage /> },
      ],
    },
  ]);
}

function AuthenticatedApp({ session }: { session: SessionResponse }) {
  const router = useMemo(() => createRouter(session), [session]);
  return <RouterProvider router={router} />;
}

export function App() {
  const session = useQuery({ key: 'session', load: api.session });
  if (session.loading) return <LoadingMessage label={text.loading} />;
  if (session.error || !session.value) {
    return (
      <ErrorNotice
        message={session.error instanceof Error ? session.error.message : text.loginFailed}
        retry={session.reload}
        retryLabel={text.retry}
      />
    );
  }
  if (!session.value.user) return <LoginPage />;
  return <AuthenticatedApp session={session.value} />;
}
