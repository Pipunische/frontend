# Используем легкий образ Python
FROM python:3.10-slim

# Устанавливаем рабочую папку внутри контейнера
WORKDIR /app

# Копируем файл с зависимостями (если его еще нет, создадим пустым)
COPY requirements.txt .

# Устанавливаем библиотеки
RUN pip install --no-cache-dir -r requirements.txt

# Копируем весь код проекта в контейнер
COPY . .

# Команда для запуска (поменяй main.py на ваш стартовый файл)
CMD ["python", "main.py"]
