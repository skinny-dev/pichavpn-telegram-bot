import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import App from './App'
import { TooltipProvider } from '@/components/ui/tooltip'
import { DirectionProvider } from '@radix-ui/react-direction'
import './index.css'
import { captureTelegramLaunch } from '@/lib/telegram'

captureTelegramLaunch() // opened as a Telegram Mini App: keep the launch data, give the router a clean hash

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false } } })

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <DirectionProvider dir="rtl">
      <TooltipProvider delayDuration={200}>
        <HashRouter>
          <App />
        </HashRouter>
        <Toaster position="top-center" dir="rtl" richColors closeButton toastOptions={{ className: 'font-sans' }} />
      </TooltipProvider>
      </DirectionProvider>
    </QueryClientProvider>
  </React.StrictMode>,
)
