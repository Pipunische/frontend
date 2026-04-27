FROM python:3.10-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
# Твой фронтендер просил именно эту команду:
CMD ["uvicorn", "clear_main:app", "--host", "0.0.0.0", "--port", "8000"]
