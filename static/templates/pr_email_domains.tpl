<h2>[[pr:register-email-domains-heading]]</h2>
<p>[[pr:register-allow-subdomain-2]]</p>
<!-- IF domains.length -->
<table class="table table-striped">
<thead>
	<tr>
		<th>[[pr:register-email-domains-type]]</th>
		<th>[[pr:register-email-domains-domain]]</th>
	</tr>
</thead>
<tbody>
{{{each domains}}}
	<tr>
		<td>{domains.type}</td>
		<td>{domains.domain}</td>
	</tr>
{{{end}}}
</tbody>
</table>
<!-- ENDIF domains.length -->