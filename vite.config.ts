import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Actions sets this per deployed ref so previews can live below an
  // S3 prefix such as /branches/feature-name/ without loading root assets.
  base: process.env.VITE_BASE_PATH ?? "/",
  plugins: [react()],
})
