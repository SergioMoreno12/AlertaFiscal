import { createRoot } from 'react-dom/client'
import App from './app/App.tsx'
import { getLang } from './i18n'
import { startDomTranslation } from './i18n/dom'
import './styles/global.css'
import './styles/public.css'

const root = document.getElementById('root')!
startDomTranslation(root, getLang())
createRoot(root).render(<App />)
