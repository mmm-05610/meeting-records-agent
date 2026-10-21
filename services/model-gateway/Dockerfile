FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY gateway.py .
ENV GATEWAY_PORT=8081
EXPOSE 8081
CMD ["python", "gateway.py"]
