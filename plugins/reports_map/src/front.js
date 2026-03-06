import React, { forwardRef } from "react";
import { createRoot } from "react-dom/client";

import ReportHeatMap from "./heatmap/ReportHeatmap.js";
import color_scales from "./heatmap/report-scales.json";
import { useEffect, useMemo, useState } from "@wordpress/element";
import { Flex } from "@wordpress/components";
// import { Playback } from "./Playback.js";
import { parse_csv, sum_columns, max_columns } from "./helpers.js";

/**
 * @typedef {Object} LiveHeatmapProps
 * @property {string} csv_text the text of the csv file
 * @property {string} source_url the url of the csv file
 * @property {React.Ref<SVGSVGElement>} ref a ref to the heatmap svg element
 */

/**
 * Dynamically Renders the saved content of the block.
 * We split this out to allow it to be rendered both in the editor and on the
 * frontend. As this has reactivity, it can't be used in the Save function.
 * @param {LiveHeatmapProps} props
 */
export const LiveHeatmap = forwardRef(({ csv_text, source_url }, ref) => {
	// TODO: add time selection controls
	const parsed = useMemo(() => parse_csv(csv_text), [csv_text]);
	const [{ years, csv }, setData] = useState(parsed);
	const [index, setIndex] = useState(undefined);

	useEffect(() => {
		(async () => {
			const url = source_url;
			const response = await fetch(url);
			const text = await response.text();
			// if we're still on the same url, update the data
			if (url === source_url) setData(parse_csv(text));
		})();
	}, [source_url]);

	const area_counts = useMemo(
		() => (index === undefined ? sum_columns(csv) : csv[index]),
		[csv, index]
	);

	const max = useMemo(() => {
		const columns = index === undefined ? sum_columns(csv) : max_columns(csv);
		return Math.max(...Object.values(columns), 1);
	}, [csv]);

	return (
		<Flex direction={["column"]}>
			{/* <Playback initialIndex={0} values={years} setIndex={() => {}} /> */}

			<ReportHeatMap
				ref={ref}
				area_counts={area_counts}
				max={max}
				scale={color_scales.custom}
			/>
		</Flex>
	);
});

window.addEventListener("load", () => {
	const blocks = document.querySelectorAll(".report-heatmap-block");
	if (blocks.length === 0) return;

	for (const block of blocks) {
		const data_props = block.getAttribute("data-props");
		if (data_props === null) continue;

		createRoot(block).render(
			<div className="report-heatmap-block" data-props={data_props}>
				<LiveHeatmap {...JSON.parse(data_props)} />
			</div>
		);
	}
});
