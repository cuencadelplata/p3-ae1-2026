import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'FLOW_')
  const services = {
    m2: env.FLOW_M2_URL || 'http://127.0.0.1:11000',
    m3: env.FLOW_M3_URL || 'http://127.0.0.1:5000',
    'm3-vehiculos': env.FLOW_M3_VEHICLES_URL || 'http://127.0.0.1:8083',
    m4: env.FLOW_M4_URL || 'http://127.0.0.1:3004',
    m5: env.FLOW_M5_URL || 'http://127.0.0.1:3005',
    m6: env.FLOW_M6_URL || 'http://127.0.0.1:15000',
    'm6-cancelacion': env.FLOW_M6_CANCELACION_URL || 'http://127.0.0.1:15001',
    m8: env.FLOW_M8_URL || 'http://127.0.0.1:18000',
    m9: env.FLOW_M9_URL || 'http://127.0.0.1:3000',
  }
  const proxy = Object.fromEntries(Object.entries(services).map(([service, target]) => {
    const prefix = `/flujo-api/${service}/`
    return [prefix, { target, rewrite: (path: string) => path.slice(prefix.length - 1) }]
  }))
  proxy['/push/app-sw.js'] = { target: services.m8, rewrite: (path: string) => path }

  return { plugins: [react()], server: { proxy }, preview: { proxy } }
})
