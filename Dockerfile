# Portable container for the CAD_AI web app. Runs on any container host
# (Render, Railway, Fly.io, Google Cloud Run, a VPS with Docker).
# Includes the FeatureScript simulator (fs_sim: Onshape std library on OpenCascade)
# so the website can execute and preview every generated feature.
FROM node:22-slim

# Python + the native libraries OpenCascade (cadquery-ocp) links against.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-venv git ca-certificates libgl1 libx11-6 libxrender1 libxext6 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY fs_sim/requirements.txt fs_sim/requirements.txt
RUN python3 -m venv /opt/fs-sim && /opt/fs-sim/bin/pip install --no-cache-dir -r fs_sim/requirements.txt
ENV FS_SIM_PYTHON=/opt/fs-sim/bin/python

COPY . .
# Onshape FeatureScript standard library (MIT) at the commit fs_sim was tested with,
# pre-parsed so the first simulation is fast.
RUN bash fs_sim/fetch_std.sh && rm -rf fs_sim/std/.git \
    && /opt/fs-sim/bin/python -c "from fs_sim.runtime import library; library()"

# Most hosts inject PORT; 10000 matches server.js and Render's default.
ENV PORT=10000
EXPOSE 10000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
