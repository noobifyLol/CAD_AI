# Hugging Face Docker Space: Text2CAD (text → DeepCAD sketch/extrude sequence) API.
# Runs on the free CPU hardware; a GPU Space only makes it faster.
FROM python:3.13-slim

RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*
RUN useradd -m -u 1000 user

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir torch==2.6.0 --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt

# Text2CAD source, pinned to the commit this service was tested against.
ARG TEXT2CAD_COMMIT=669a81472ede2269837c22a4d00070eaac360c82
RUN git init /opt/Text2CAD && cd /opt/Text2CAD \
    && git remote add origin https://github.com/SadilKhan/Text2CAD \
    && git fetch --depth 1 origin ${TEXT2CAD_COMMIT} && git checkout FETCH_HEAD

# Bake the (public) text encoder into the image. The Text2CAD checkpoint is a gated
# dataset, so app.py downloads it (87 MB) at startup with the HF_TOKEN Space secret.
ENV HF_HOME=/opt/hf-cache TEXT2CAD_DIR=/opt/Text2CAD
RUN python -c "from huggingface_hub import snapshot_download; \
snapshot_download('google-bert/bert-large-uncased', allow_patterns=['*.json', '*.txt', '*.safetensors'])" \
    && chown -R user /opt/hf-cache

COPY --chown=user . /app
USER user
EXPOSE 7860
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]
