import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import App from './App'
import { StoreProvider } from './lib/store'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      <App />
      <Toaster
        theme="dark"
        position="bottom-right"
        gap={8}
        toastOptions={{
          style: {
            background: '#17171a',
            border: '1px solid rgba(255,255,255,0.09)',
            color: '#e4e4e7',
            fontSize: '13px',
          },
        }}
      />
    </StoreProvider>
  </StrictMode>,
)
