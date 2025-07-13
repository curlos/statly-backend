import asyncio
from todoist_api_python.api_async import TodoistAPIAsync
import json
from datetime import datetime, timedelta
from dateutil import parser
from dotenv import load_dotenv
import os
from calendar import monthrange

load_dotenv()


class TodoistDataFetcher:
    def __init__(self, api_token, account_type):
        self.api = TodoistAPIAsync(api_token)

        self.personal_archived_project_ids = os.getenv(
            "TODOIST_PERSONAL_ACCOUNT_ARCHIVED_PROJECT_IDS"
        ).split(",")
        self.work_archived_project_ids = []
        self.archived_project_ids = (
            self.personal_archived_project_ids
            if account_type == "personal"
            else self.work_archived_project_ids
        )

        self.date_ranges = [
            (
                datetime(year, month, 1, 0, 0, 0)
                .replace(tzinfo=datetime.utcnow().astimezone().tzinfo)
                .isoformat()
                .replace("+00:00", "Z"),
                datetime(year, month + 2, monthrange(year, month + 2)[1], 23, 59, 59)
                .replace(tzinfo=datetime.utcnow().astimezone().tzinfo)
                .isoformat()
                .replace("+00:00", "Z"),
            )
            for year in range(2010, 2025 + 1)
            for month in (1, 4, 7, 10)
            if not (year == 2025 and month > 7)
        ]
        self.date_ranges = [
            (parser.isoparse(start), parser.isoparse(end))
            for start, end in self.date_ranges
        ]

    async def fetch_task_by_id(self, task_id):
        return await self.api.get_task(task_id)

    async def fetch_task_by_id(self, tasks_file, output_file):
        try:
            with open(tasks_file, "r") as f:
                completed_tasks = json.load(f)
        except FileNotFoundError:
            print(f"File {tasks_file} not found. Please fetch completed tasks first.")
            return

        full_tasks = []

        for task in completed_tasks:
            try:
                full_task = await self.fetch_task_by_id(task["id"])
                full_tasks.append(full_task.to_dict())
            except Exception as e:
                print(f"Failed to fetch task {task['id']}: {e}")

        with open(output_file, "w") as f:
            json.dump(full_tasks, f, indent=2)

        print(f"Fetched {len(full_tasks)} full tasks.")

    async def fetch_completed_tasks(
        self, output_file="completed_tasks.json", verbose=True
    ):
        all_completed = []

        for since, until in self.date_ranges:
            try:
                generator = await self.api.get_completed_tasks_by_completion_date(
                    since=since, until=until
                )
                async for page in generator:
                    all_completed.extend(page)
            except Exception as e:
                if verbose:
                    print(f"Error fetching tasks from {since} to {until}: {e}")

        os.makedirs(os.path.dirname(output_file), exist_ok=True)

        with open(output_file, "w") as f:
            json.dump([task.to_dict() for task in all_completed], f, indent=2)

    async def fetch_active_projects(self, output_file="todoist_projects.json"):
        try:
            project_generator = await self.api.get_projects()
            projects = []
            async for batch in project_generator:
                projects.extend(batch)

            os.makedirs(os.path.dirname(output_file), exist_ok=True)

            with open(output_file, "w") as f:
                json.dump([p.to_dict() for p in projects], f, indent=2)
            print(f"Fetched {len(projects)} projects.")
        except Exception as e:
            print(f"Error fetching projects: {e}")

    async def fetch_archived_projects(
        self, output_file="todoist_archived_projects.json"
    ):
        projects = []
        failed = []

        for project_id in self.archived_project_ids:
            try:
                project = await self.api.get_project(project_id)
                projects.append(project.to_dict())
            except Exception as e:
                failed.append(project_id)
                print(f"Failed to fetch project {project_id}: {e}")

        os.makedirs(os.path.dirname(output_file), exist_ok=True)

        with open(output_file, "w") as f:
            json.dump(projects, f, indent=2)


def fetch_all_data(account_type):
    TODOIST_API_TOKEN = (
        os.getenv("TODOIST_API_TOKEN_PERSONAL_ACCOUNT")
        if account_type == "personal"
        else os.getenv("TODOIST_API_TOKEN_WORK_ACCOUNT")
    )

    if not TODOIST_API_TOKEN:
        raise RuntimeError(
            "'TODOIST_API_TOKEN_PERSONAL_ACCOUNT' or 'TODOIST_API_TOKEN_WORK_ACCOUNT' is not set in the .env file"
        )

    todoist_data_fetcher = TodoistDataFetcher(TODOIST_API_TOKEN, account_type)

    asyncio.run(
        todoist_data_fetcher.fetch_completed_tasks(
            output_file=f"data/{account_type}/api_v1_todoist_all_{account_type}_completed_tasks.json"
        )
    )

    asyncio.run(
        todoist_data_fetcher.fetch_active_projects(
            output_file=f"data/{account_type}/api_v1_todoist_all_{account_type}_active_projects.json"
        )
    )

    asyncio.run(
        todoist_data_fetcher.fetch_archived_projects(
            output_file=f"data/{account_type}/api_v1_todoist_all_{account_type}_archived_projects.json"
        )
    )


if __name__ == "__main__":
    fetch_all_data("personal")
    fetch_all_data("work")
