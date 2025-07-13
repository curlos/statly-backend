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

    async def fetch_completed_tasks(
        self, output_file="completed_tasks.ts", verbose=True
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

        # Ensure output directory exists
        os.makedirs(os.path.dirname(output_file), exist_ok=True)

        # Step 1: Export raw tasks to TypeScript file
        raw_tasks = [task.to_dict() for task in all_completed]
        self.export_to_ts(raw_tasks, output_file)

        # Step 2: Group by ID and export to a new .ts file
        tasks_by_id = {task["id"]: task for task in raw_tasks}

        base, ext = os.path.splitext(output_file)
        grouped_output_file = f"{base}_by_id{ext}"
        self.export_to_ts(tasks_by_id, grouped_output_file)

    async def fetch_active_tasks(self, output_file="todoist_active_tasks.ts"):
        tasks = []
        try:
            task_generator = await self.api.get_tasks()
            async for batch in task_generator:
                tasks.extend(batch)

            tasks_dict = [task.to_dict() for task in tasks]
            tasks_by_id = {task["id"]: task for task in tasks_dict}

            # Export both the full list and the grouped version to TS
            self.export_to_ts(tasks_dict, output_file)
            self.export_to_ts(tasks_by_id, output_file.replace(".ts", "_by_id.ts"))

            print(f"Fetched {len(tasks)} active tasks.")
        except Exception as e:
            print(f"Error fetching active tasks: {e}")

    async def fetch_active_projects(self, output_file="todoist_projects.ts"):
        try:
            project_generator = await self.api.get_projects()
            projects = []
            async for batch in project_generator:
                projects.extend(batch)

            project_dicts = [p.to_dict() for p in projects]

            self.export_to_ts(project_dicts, output_file)

            print(f"Fetched {len(projects)} projects.")
        except Exception as e:
            print(f"Error fetching projects: {e}")

    async def fetch_archived_projects(self, output_file="todoist_archived_projects.ts"):
        projects = []
        failed = []

        for project_id in self.archived_project_ids:
            try:
                project = await self.api.get_project(project_id)
                projects.append(project.to_dict())
            except Exception as e:
                failed.append(project_id)
                print(f"Failed to fetch project {project_id}: {e}")

        self.export_to_ts(projects, output_file)

    def group_tasks_by_id(self, input_file, output_file=None):
        try:
            with open(input_file, "r") as f:
                tasks = json.load(f)
        except FileNotFoundError:
            print(f"File {input_file} not found.")
            return

        tasks_by_id = {task["id"]: task for task in tasks}

        if output_file is None:
            base, ext = os.path.splitext(input_file)
            output_file = f"{base}_by_id{ext}"

        os.makedirs(os.path.dirname(output_file), exist_ok=True)

        with open(output_file, "w") as f:
            json.dump(tasks_by_id, f, indent=2)

        print(f"Grouped tasks by ID and wrote to {output_file}")

    def export_to_ts(self, data, ts_output_path):
        ts_var_name = (
            os.path.basename(ts_output_path).replace(".ts", "").replace("-", "_")
        )

        os.makedirs(os.path.dirname(ts_output_path), exist_ok=True)

        with open(ts_output_path, "w") as ts_file:
            ts_file.write(f"export const {ts_var_name} = ")
            json.dump(data, ts_file, indent=2)
            ts_file.write(";")

        print(f"Wrote TypeScript export to {ts_output_path}")


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
            output_file=f"data/{account_type}/api_v1_todoist_all_{account_type}_completed_tasks.ts"
        )
    )

    asyncio.run(
        todoist_data_fetcher.fetch_active_tasks(
            output_file=f"data/{account_type}/api_v1_todoist_all_{account_type}_active_tasks.ts"
        )
    )

    asyncio.run(
        todoist_data_fetcher.fetch_active_projects(
            output_file=f"data/{account_type}/api_v1_todoist_all_{account_type}_active_projects.ts"
        )
    )

    asyncio.run(
        todoist_data_fetcher.fetch_archived_projects(
            output_file=f"data/{account_type}/api_v1_todoist_all_{account_type}_archived_projects.ts"
        )
    )


if __name__ == "__main__":
    fetch_all_data("personal")
    fetch_all_data("work")
