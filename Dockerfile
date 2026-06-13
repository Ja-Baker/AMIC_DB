FROM python:3.12-slim

WORKDIR /app

# System libs fastembed/onnxruntime may need.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libgomp1 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download the bge-base model into the image so cold starts are fast/reliable.
ENV FASTEMBED_CACHE_PATH=/app/.fastembed_cache
RUN python -c "from fastembed import TextEmbedding; TextEmbedding(model_name='BAAI/bge-base-en-v1.5')"

COPY . .

# Railway provides $PORT.
ENV PORT=8000
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
