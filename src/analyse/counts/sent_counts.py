# %% [markdown]
# ## Process
# We count the number of reports in each death category, ignoring reports that
# don't match any known category. We then save the results to a .csv file.

# %% [markdown]
# ### Importing libraries

import os
import re
import pandas as pd

from helpers import toml_stats, percent

TOP_N = 30

PATH = os.path.dirname(__file__)
DATA_PATH = os.path.abspath(f"{PATH}/data")
REPORTS_PATH = os.path.abspath(f"{PATH}/../../data")
CORRECT_PATH = os.path.abspath(f"{PATH}/../../correct")

# %% [markdown]
# ### Reading the reports

reports = pd.read_csv(f"{REPORTS_PATH}/reports-analysed.csv")
fetched = pd.read_csv(f"{REPORTS_PATH}/reports.csv")

fetched_non_na = fetched.dropna(subset=["this_report_is_being_sent_to"])

# %% [markdown]
# ### Calculating the due status for each report

today = pd.to_datetime("today")
report_date = pd.to_datetime(reports["date_of_report"], errors="coerce", dayfirst=True)
report_due = (today - report_date).dt.days > 56

# %% [markdown]
# ### Splitting the sent to and reply urls

vbar = re.compile(r"\s*\|\s*")
non_na = (
    reports.assign(year=report_date.dt.year)
    .dropna(subset=["this_report_is_being_sent_to"])
    .copy()
)
non_na["status"] = "overdue"
non_na["sent_to"] = non_na["this_report_is_being_sent_to"].str.split(vbar)
non_na["no. recipients"] = non_na["sent_to"].str.len()

non_na["replies"] = (
    non_na["reply_urls"]
    .fillna("")
    .str.split(vbar)
    .apply(lambda replies: [reply for reply in replies if "Response" in reply])
)
non_na["no. replies"] = non_na["replies"].str.len()

non_na["escaped_urls"] = (
    non_na["reply_urls"].str.replace(r"[-_]|%20", " ", regex=True).fillna("")
)

# %% [markdown]
# ### Status based on no. recipients vs replies

equal_replies = non_na.apply(
    lambda x: len(x["sent_to"]) == len(x["replies"]) and len(x["sent_to"]) > 0, axis=1
)
non_na.loc[equal_replies, "status"] = "received"
non_na.loc[~report_due, "status"] = "pending"

# %% [markdown]
# ### Status based on recipients in replies

exploded = non_na.explode("sent_to", ignore_index=True)
responded = exploded.apply(
    lambda x: str(x["sent_to"]) in str(x["escaped_urls"]), axis=1
)
exploded["status"] = exploded["status"].mask(responded, "received")

# %% [markdown]
# ### Calculating the counts for each recipient

sent_types = exploded.value_counts(["sent_to", "status"]).unstack(fill_value=0)
sent_types["no. PFDs"] = exploded["sent_to"].value_counts()
sent_types = sent_types[["no. PFDs", "overdue", "pending", "received"]].sort_values(
    "no. PFDs", ascending=False
)
sent_types["% received"] = (
    sent_types["received"] / sent_types["no. PFDs"] * 100
).round(1)

sent_counts = exploded.value_counts("sent_to")
sent_years = exploded.value_counts(["year", "status"]).unstack(fill_value=0)
type_counts = exploded.value_counts("status")

# %% [markdown]
# ### Calculating the status of each report

non_na.loc[:, "response status"] = "partial"

# for each report, calculate the list of recipients with responses
responses_from = lambda row: [
    sent for sent in row["sent_to"] if sent in row["escaped_urls"]
]
with_responses = non_na.apply(responses_from, axis=1)

# if there's none, mark overdue
no_responses = with_responses.str.len() == 0
non_na.loc[no_responses, "response status"] = "overdue"

# if there's an equal number of recipients and replies, mark completed
equal_len = (non_na["sent_to"].str.len() == non_na["replies"].str.len()) & (
    non_na["sent_to"].str.len() > 0
)
non_na.loc[equal_len, "response status"] = "completed"

# if all are responded to, mark completed
all_responses = with_responses.str.len() >= non_na["sent_to"].str.len()
non_na.loc[all_responses, "response status"] = "completed"

# if a report is pending or overdue and less than 56 days old, mark pending
non_na.loc[
    ~report_due & (non_na["response status"] == "overdue"), "response status"
] = "pending"
non_na.loc[
    ~report_due & (non_na["response status"] == "partial"), "response status"
] = "pending"

# %% [markdown]
# ### Adding the non_na rows back to the reports

reports.loc[:, "response status"] = "failed"
reports.loc[non_na.index, "response status"] = non_na["response status"]
empty_requests = fetched["this_report_is_being_sent_to"].isna()
reports.loc[empty_requests, "response status"] = "no requests"

reports.loc[:, "no. recipients"] = 0
reports.loc[non_na.index, "no. recipients"] = non_na["no. recipients"]

reports.loc[:, "no. replies"] = 0
reports.loc[non_na.index, "no. replies"] = non_na["no. replies"]

print(reports[["ref", "response status"]].head(10))
print(reports["response status"].value_counts())

# %% [markdown]
# ### Calculating response status over time

status_years = (
    reports.assign(year=report_date.dt.year)
    .value_counts(["year", "response status"])
    .unstack(fill_value=0)
)
status_years = status_years[
    ["no requests", "failed", "pending", "overdue", "partial", "completed"]
]

# %% [markdown]
# ### Writing back the reports with the status

# Add our new columns to the reports
report_columns = reports.columns.tolist()
report_columns.insert(0, "response status")
count_idx = report_columns.index("this_report_is_being_sent_to") + 1
report_columns.insert(count_idx, "no. replies")
report_columns.insert(count_idx, "no. recipients")
report_columns = list(dict.fromkeys(report_columns))

reports[report_columns].to_csv(f"{REPORTS_PATH}/reports-analysed.csv", index=False)

# %% [markdown]
# ### Calculating statistics

status_counts = reports.value_counts("response status")

# %% [markdown]
# ### Calculating statistics over coroner areas

area_statuses = reports.value_counts(["coroner_area", "response status"]).unstack(
    fill_value=0
)
area_statuses.loc[:, ["no. recipients", "no. replies"]] = reports.groupby(
    "coroner_area"
)[["no. recipients", "no. replies"]].sum()
area_statuses = area_statuses.rename(
    {
        "completed": "no. complete responses",
        "partial": "no. partial responses",
        "overdue": "no. overdue responses",
        "failed": "no. failed parses",
        "pending": "no. pending responses",
    },
    axis=1,
)
area_statuses["no. PFDs"] = reports["coroner_area"].value_counts()
area_statuses = area_statuses.sort_values("no. PFDs", ascending=False)
area_statuses = area_statuses[
    [
        "no. PFDs",
        "no. recipients",
        "no. replies",
        "no. complete responses",
        "no. partial responses",
        "no. overdue responses",
        "no. pending responses",
        "no. failed parses",
    ]
]

# %% [markdown]
# ### Calculating statistics over coroner names

name_statuses = reports.value_counts(["coroner_name", "response status"]).unstack(
    fill_value=0
)
name_statuses.loc[:, ["no. recipients", "no. replies"]] = reports.groupby(
    "coroner_name"
)[["no. recipients", "no. replies"]].sum()
name_statuses = name_statuses.rename(
    {
        "completed": "no. complete responses",
        "partial": "no. partial responses",
        "overdue": "no. overdue responses",
        "failed": "no. failed parses",
        "pending": "no. pending responses",
    },
    axis=1,
)
name_statuses["no. PFDs"] = reports["coroner_name"].value_counts()
name_statuses = name_statuses.sort_values("no. PFDs", ascending=False)
name_statuses = name_statuses[
    [
        "no. PFDs",
        "no. recipients",
        "no. replies",
        "no. complete responses",
        "no. partial responses",
        "no. overdue responses",
        "no. pending responses",
        "no. failed parses",
    ]
]

# %% [markdown]
# ### Calculating statistics over recipients

exploded = reports.assign(
    sent_to=reports["this_report_is_being_sent_to"].str.split(vbar)
).explode("sent_to", ignore_index=True)
rcpt_statuses = exploded.value_counts(["sent_to", "response status"]).unstack(
    fill_value=0
)
rcpt_statuses.loc[:, ["no. recipients", "no. replies"]] = exploded.groupby("sent_to")[
    ["no. recipients", "no. replies"]
].sum()
rcpt_statuses = rcpt_statuses.rename(
    {
        "completed": "no. complete responses",
        "partial": "no. partial responses",
        "overdue": "no. overdue responses",
        "pending": "no. pending responses",
    },
    axis=1,
)
rcpt_statuses["no. PFDs"] = exploded["sent_to"].value_counts()
rcpt_statuses = rcpt_statuses.sort_values("no. PFDs", ascending=False)
rcpt_statuses = rcpt_statuses[
    [
        "no. PFDs",
        "no. recipients",
        "no. replies",
        "no. complete responses",
        "no. partial responses",
        "no. overdue responses",
        "no. pending responses",
    ]
]
# Quick note here: we won't ever get the no. failed parses as a recipient is only found if the parse is successful

# %% [markdown]
# ### Various statistics about the counts

without = len(fetched) - len(fetched_non_na)
failed = len(fetched_non_na) - len(non_na)

toml_stats["this report is sent to"] = statistics = {
    "reports parsed": [float(len(non_na)), percent(len(non_na), len(fetched))],
    "reports without recipients": [float(without), percent(without, len(fetched))],
    "reports failed": [float(failed), percent(failed, len(fetched))],
    "reports pending": [
        float(status_counts["pending"]),
        percent(status_counts["pending"], len(fetched)),
    ],
    "reports overdue": [
        float(status_counts["overdue"]),
        percent(status_counts["overdue"], len(fetched)),
    ],
    "reports partial": [
        float(status_counts["partial"]),
        percent(status_counts["partial"], len(fetched)),
    ],
    "reports completed": [
        float(status_counts["completed"]),
        percent(status_counts["completed"], len(fetched)),
    ],
}

toml_stats["requests for response"] = {
    "no. recipients with requests": len(sent_counts),
    "no. requests for response": len(exploded),
    "requests pending": [
        float(type_counts["pending"]),
        percent(type_counts["pending"], len(exploded)),
    ],
    "requests received": [
        float(type_counts["received"]),
        percent(type_counts["received"], len(exploded)),
    ],
    "requests overdue": [
        float(type_counts["overdue"]),
        percent(type_counts["overdue"], len(exploded)),
    ],
    "mean no. requests per recipient": round(sent_counts.mean(), 1),
    "median no. requests per recipient": sent_counts.median(),
    "IQR of requests per recipients": list(sent_counts.quantile([0.25, 0.75])),
}

print(f"Name count statistics: {statistics}")
print(f"Sorted counts: {sent_counts}")

# %% [markdown]
# ### Calculating the top coroners

top_counts = sent_counts.head(TOP_N)
top_types = sent_types.loc[top_counts.index]

# %% [markdown]
# ### Saving the results

sent_counts.to_csv(f"{DATA_PATH}/sent/sent-counts.csv")
top_counts.to_csv(f"{DATA_PATH}/sent/top-sent-counts.csv")
sent_types.to_csv(f"{DATA_PATH}/sent/sent-types.csv")
top_types.to_csv(f"{DATA_PATH}/sent/top-sent-types.csv")
sent_years.to_csv(f"{DATA_PATH}/sent/sent-types-years.csv")
status_years.to_csv(f"{DATA_PATH}/sent/status-years.csv")
exploded.to_csv(f"{DATA_PATH}/sent/statuses.csv", index=False)

area_statuses.to_csv(f"{DATA_PATH}/sent/area-statuses.csv")
name_statuses.to_csv(f"{DATA_PATH}/sent/name-statuses.csv")
rcpt_statuses.to_csv(f"{DATA_PATH}/sent/rcpt-statuses.csv")
