#!/usr/bin/env python3
"""Generate the ICLR figures from the canonical identical-target analysis."""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

import matplotlib as mpl
import matplotlib.pyplot as plt
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
PAPER_DIR = ROOT / "iclr2027"
if not PAPER_DIR.exists():
    PAPER_DIR = ROOT / "paper"
ANALYSIS = PAPER_DIR / "neutral_confound_suite_v1.json"
FIGURES = PAPER_DIR / "fig"

INK = "#20262B"
GRID = "#DDE2E5"
SHARED = "#C64B3C"
PERSONAL = "#8A969E"
DEBATE = "#2D758B"
PROTOCOLS = ("shared memory", "personal memory", "debate")
COLORS = {"shared memory": SHARED, "personal memory": PERSONAL, "debate": DEBATE}
LABELS = {"shared memory": "Shared memory", "personal memory": "Personal memory", "debate": "Live debate"}


def setup() -> None:
    mpl.rcParams.update(
        {
            "font.family": "DejaVu Sans",
            "font.size": 8.5,
            "axes.labelcolor": INK,
            "axes.edgecolor": "#AAB3B8",
            "axes.linewidth": 0.7,
            "xtick.color": INK,
            "ytick.color": INK,
            "pdf.fonttype": 42,
            "ps.fonttype": 42,
            "savefig.facecolor": "white",
        }
    )
    FIGURES.mkdir(parents=True, exist_ok=True)


def load() -> dict:
    with ANALYSIS.open() as handle:
        return json.load(handle)


def index(rows: list[dict], row_key: str) -> dict[tuple[str, str], dict]:
    return {(row[row_key], row["protocol"]): row for row in rows}


def polish(ax: plt.Axes, show_y: bool = True) -> None:
    ax.set_ylim(0, 1.06)
    ax.set_yticks([0, 0.5, 1.0], ["0", ".5", "1"])
    ax.grid(axis="y", color=GRID, linewidth=0.7, zorder=0)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    if not show_y:
        ax.spines["left"].set_visible(False)
        ax.tick_params(axis="y", left=False, labelleft=False)
    ax.tick_params(length=0, pad=3)


def draw_grouped_bars(
    ax: plt.Axes,
    names: list[str],
    values: dict[str, list[float]],
    *,
    label_values: bool = True,
) -> None:
    x = np.arange(len(names))
    width = 0.24
    for offset, protocol in zip((-1, 0, 1), PROTOCOLS):
        bars = ax.bar(
            x + offset * width,
            values[protocol],
            width,
            color=COLORS[protocol],
            edgecolor="white",
            linewidth=0.5,
            label=LABELS[protocol],
            zorder=3,
        )
        if label_values:
            for bar, value in zip(bars, values[protocol]):
                if value >= 0.04:
                    inside = value >= 0.88
                    value_label = f"{value:.2f}".lstrip("0").rstrip("0").rstrip(".")
                    ax.text(
                        bar.get_x() + bar.get_width() / 2,
                        value - 0.055 if inside else value + 0.025,
                        value_label,
                        ha="center",
                        va="top" if inside else "bottom",
                        fontsize=7,
                        color="white" if inside else INK,
                    )
    ax.set_xticks(x, names)


def task_protocol_figure(data: dict) -> None:
    cross_topic = index(data["cross_topic"], "topic")
    familiar = [
        ("MMR", "MMR and autism"),
        ("Climate", "climate attribution"),
        ("STAP", "STAP cells"),
        ("LK-99", "LK-99"),
        ("Ego\ndepletion", "ego depletion"),
        ("PANDAS", "PANDAS diagnosis"),
    ]
    familiar_values = {
        protocol: [cross_topic[(key, protocol)]["mean_fe_t"] for _, key in familiar]
        for protocol in PROTOCOLS
    }

    categories = index(data["core_task_categories"], "task_category")
    scitat = {row["protocol"]: row for row in data["expanded_scitat_neutral"]}
    groups = [
        ("GSM8K\n5 tasks", "GSM8K"),
        ("GSM-Hard\n5 tasks", "GSM-Hard"),
        ("SciTaT-A/B\n(2)", "SciTaT core subset (2)"),
        ("Selected\nSciTaT\n(18)", "expanded"),
    ]
    group_values: dict[str, list[float]] = {}
    for protocol in PROTOCOLS:
        group_values[protocol] = [
            scitat[protocol]["mean_fe_t"] if key == "expanded" else categories[(key, protocol)]["mean_fe_t"]
            for _, key in groups
        ]

    fig, axes = plt.subplots(
        1,
        2,
        figsize=(7.2, 2.55),
        gridspec_kw={"width_ratios": [1.3, 1], "wspace": 0.12},
        sharey=True,
    )
    draw_grouped_bars(axes[0], [label for label, _ in familiar], familiar_values)
    draw_grouped_bars(axes[1], [label for label, _ in groups], group_values)
    axes[0].set_title("A  Familiar science tasks", loc="left", fontsize=9.5, pad=6)
    axes[1].set_title("B  Other task groups", loc="left", fontsize=9.5, pad=6)
    axes[0].set_ylabel("Neutral-agent false-answer rate")
    axes[1].tick_params(axis="x", labelsize=7.5)
    polish(axes[0], show_y=True)
    polish(axes[1], show_y=False)
    handles, legend_labels = axes[0].get_legend_handles_labels()
    fig.legend(
        handles,
        legend_labels,
        frameon=False,
        ncol=3,
        loc="upper center",
        bbox_to_anchor=(0.5, 1.0),
        fontsize=7.4,
        handlelength=1.2,
        columnspacing=1.1,
    )
    fig.subplots_adjust(left=0.075, right=0.995, top=0.78, bottom=0.22)
    fig.savefig(FIGURES / "fig_task_protocols.png", dpi=350, bbox_inches="tight")
    fig.savefig(FIGURES / "fig_task_protocols.pdf", bbox_inches="tight")
    plt.close(fig)


def adversary_ratio_figure(data: dict) -> None:
    rows = data["adversary_ratio_standardized"]
    lookup = {(int(row["adversary_count"]), row["protocol"]): row for row in rows}
    counts = [1, 2, 3, 4]
    fig, ax = plt.subplots(figsize=(5.4, 2.8))
    styles = {
        "shared memory": ("o-", 2.0),
        "personal memory": ("s--", 1.35),
        "debate": ("^:", 1.35),
    }
    for protocol in PROTOCOLS:
        values = [lookup[(count, protocol)]["mean_fe_t"] for count in counts]
        style, linewidth = styles[protocol]
        ax.plot(
            counts,
            values,
            style,
            color=COLORS[protocol],
            linewidth=linewidth,
            markersize=5.5,
            label=LABELS[protocol],
            zorder=3,
        )
        if protocol == "shared memory":
            for count, value in zip(counts, values):
                ax.text(
                    count,
                    value + 0.04,
                    f"{value:.3f}",
                    ha="center",
                    va="bottom",
                    fontsize=7.5,
                    color=INK,
                )
    ax.set_xticks(counts, [f"{count}/6" for count in counts])
    ax.set_xlabel("Persistent-false sources")
    ax.set_ylabel(r"Target-agent adoption (FE$_t$)")
    ax.set_ylim(-0.03, 1.08)
    ax.set_yticks([0, 0.5, 1], ["0", ".5", "1"])
    ax.grid(axis="y", color=GRID, linewidth=0.7)
    ax.spines[["top", "right"]].set_visible(False)
    ax.tick_params(length=0)
    ax.legend(frameon=False, ncol=3, fontsize=7.5, loc="upper center", bbox_to_anchor=(0.5, 1.16))
    fig.subplots_adjust(left=0.14, right=0.99, top=0.80, bottom=0.22)
    fig.savefig(FIGURES / "fig_adversary_ratio.png", dpi=350, bbox_inches="tight")
    fig.savefig(FIGURES / "fig_adversary_ratio.pdf", bbox_inches="tight")
    plt.close(fig)


def short_scitat_label(topic: str) -> str:
    if topic.startswith("SciTaT 1512"):
        return "1512-q2"
    if topic.startswith("SciTaT math"):
        return "math-q2"
    parts = topic.split("_")
    if len(parts) >= 3:
        return f"{parts[1][:4]}-{parts[-1]}"
    return topic


def scitat_heatmap(data: dict) -> None:
    rows = data["expanded_scitat_neutral_by_item"]
    topics = sorted({row["topic"] for row in rows}, key=short_scitat_label)
    lookup = {(row["topic"], row["protocol"]): row["mean_fe_t"] for row in rows}
    matrix = np.array([[lookup[(topic, protocol)] for topic in topics] for protocol in PROTOCOLS])

    cmap = mpl.colors.LinearSegmentedColormap.from_list("adoption", ["#F4F6F7", "#E8B8AE", SHARED])
    fig, ax = plt.subplots(figsize=(7.2, 2.25))
    image = ax.imshow(matrix, cmap=cmap, vmin=0, vmax=1, aspect="auto")
    ax.set_xticks(range(len(topics)), [short_scitat_label(topic) for topic in topics], rotation=55, ha="right", fontsize=7)
    ax.set_yticks(range(3), [LABELS[p] for p in PROTOCOLS], fontsize=8)
    ax.tick_params(length=0)
    for row_index in range(matrix.shape[0]):
        for column_index in range(matrix.shape[1]):
            value = matrix[row_index, column_index]
            color = "white" if value >= 0.72 else INK
            ax.text(column_index, row_index, f"{value:.2f}".lstrip("0"), ha="center", va="center", fontsize=6.3, color=color)
    for spine in ax.spines.values():
        spine.set_visible(False)
    colorbar = fig.colorbar(image, ax=ax, fraction=0.022, pad=0.015)
    colorbar.set_ticks([0, 0.5, 1])
    colorbar.set_ticklabels(["0", ".5", "1"])
    colorbar.set_label(r"FE$_t$", fontsize=8)
    fig.tight_layout()
    fig.savefig(FIGURES / "fig_scitat_heatmap.png", dpi=350, bbox_inches="tight")
    fig.savefig(FIGURES / "fig_scitat_heatmap.pdf", bbox_inches="tight")
    plt.close(fig)


def cross_model_modes_figure(data: dict) -> None:
    totals: dict[tuple[str, str], list[float]] = defaultdict(lambda: [0.0, 0.0])
    for row in data["cross_model_multitask"]:
        key = (row["model"], row["protocol"])
        totals[key][0] += row["mean_fe_t"] * row["n"]
        totals[key][1] += row["n"]
    models = ["GPT-4o-mini", "Llama 3.1 8B", "Ministral 8B"]
    values = {
        protocol: [totals[(model, protocol)][0] / totals[(model, protocol)][1] for model in models]
        for protocol in PROTOCOLS
    }
    fig, ax = plt.subplots(figsize=(5.6, 2.8))
    draw_grouped_bars(ax, ["GPT-4o-mini", "Llama 3.1\n8B", "Ministral\n8B"], values)
    ax.set_ylabel(r"Target-agent adoption (FE$_t$)")
    polish(ax)
    ax.legend(frameon=False, ncol=3, fontsize=7.5, loc="upper left")
    fig.tight_layout()
    fig.savefig(FIGURES / "fig_crossmodel_modes.png", dpi=350, bbox_inches="tight")
    fig.savefig(FIGURES / "fig_crossmodel_modes.pdf", bbox_inches="tight")
    plt.close(fig)


def main() -> None:
    setup()
    data = load()
    task_protocol_figure(data)
    adversary_ratio_figure(data)
    scitat_heatmap(data)
    cross_model_modes_figure(data)
    print("Generated 4 figures from", ANALYSIS)


if __name__ == "__main__":
    main()
