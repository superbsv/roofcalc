\# ArtBudTrading Roof Calculator



\## Стек

\- Frontend: React + TypeScript (CRA), C:\\roofcalc\\myapp\\

\- Backend: PHP 7.4 на ADM.TOOLS хостингу

\- БД: MySQL hj409222\_db

\- Live: https://artbudtrading.com.ua/calculator/

\- GitHub: https://github.com/superbsv/roofcalc



\## Деплой

git add . \&\& git commit -m "опис" \&\& git push

GitHub Actions автоматично білдить і деплоїть на хостинг через FTP.



\## Поточний стан

\- Авторизація працює (логін: admin)

\- Проекти: створення, список

\- Скати: створення, параметри, розрахунок

\- Результат: листи по довжинах, доборні елементи

\- Продукція: картка матеріалу (МЧ, ПН, ФП)

\- Схема розкладки: в розробці (LayoutScheme.tsx)

\- Автодеплой: GitHub Actions → FTP



\## Наступні задачі

1\. Перевірити GitHub Actions деплой

2\. Схема розкладки листів з розмірами

3\. Шаблони скатів (прямокутник, трапеція тощо)

4\. Вибір матеріалу при створенні проекту

5\. Прибрати ціни з результатів розрахунку

