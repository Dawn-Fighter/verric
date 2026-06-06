/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit a self-contained server bundle (.next/standalone) so the Docker
  // runtime image only needs the traced files, not the full node_modules.
  output: "standalone"
};

export default nextConfig;
