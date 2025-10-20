FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV FLASK_APP=run.py

CMD ["gunicorn", "-w", "4", "-b", "0.0.0.0:5010", "run:app"]
