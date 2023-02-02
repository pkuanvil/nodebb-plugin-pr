<!-- IF toArray.length -->
<details>
	<summary class="btn btn-secondary">[[pr:dkim-summary-label]]</summary>
	<table class="table table-striped">
	<thead>
		<tr>
			<th>[[pr:dkim-details.signing-domain]]</th>
			<th>[[pr:dkim-details.to]]</th>
			<th>[[pr:dkim-details.result]]</th>
			<th>[[pr:dkim-details.comment]]</th>
		</tr>
	</thead>
	{{{each toArray}}}
		<tr>
			<td>{toArray.signingDomain}</td>
			<td>{toArray.to}</td>
			<td>{toArray.result}</td>
			<td>{toArray.comment}</td>
		</tr>
	{{{end}}}
	</tbody>
	</table>
</details>
<!-- ENDIF toArray.length -->