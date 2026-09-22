function Get-RatehawkContractCheckSummary {
    param(
        [string]$Endpoint,
        [int]$StatusCode,
        [string]$ResponseBody,
        [bool]$NoStore
    )

    $outcome = 'unexpected_response'
    $body = $null
    try {
        $body = ConvertFrom-Json -InputObject $ResponseBody -ErrorAction Stop
        if ($StatusCode -eq 200 -and $body.success -is [bool] -and $body.success) {
            $outcome = 'ok'
        } elseif (@(
            'unauthorized', 'booking_auth_not_configured', 'server_to_server_only',
            'supplier_unauthorized', 'supplier_credentials_missing',
            'supplier_endpoint_unavailable', 'supplier_request_rejected',
            'supplier_connection_failed', 'supplier_unknown', 'rate_limit',
            'contract_unavailable', 'financial_details_unavailable',
            'invalid_contract_response', 'invalid_financial_details_response',
            'contract_service_unavailable'
        ) -contains $body.error) {
            $outcome = $body.error
        }
    } catch {
        $outcome = 'invalid_response'
    } finally {
        $body = $null
    }

    [pscustomobject]@{
        endpoint = $Endpoint
        httpStatus = $StatusCode
        result = $outcome
        noStore = $NoStore
    }
}

function Invoke-RatehawkContractsCheck {
    param([Parameter(Mandatory = $true)][System.Security.SecureString]$Token)

    $plainToken = $null
    $client = $null
    $handler = $null
    try {
        Add-Type -AssemblyName System.Net.Http
        $plainToken = [System.Net.NetworkCredential]::new('', $Token).Password
        if ($plainToken.Length -lt 32 -or $plainToken -match '\s') {
            Write-Output 'Invalid token format. No requests sent.'
            return
        }

        $handler = [System.Net.Http.HttpClientHandler]::new()
        $handler.AllowAutoRedirect = $false
        $handler.UseCookies = $false
        $client = [System.Net.Http.HttpClient]::new($handler)
        $client.Timeout = [TimeSpan]::FromSeconds(30)
        $client.DefaultRequestHeaders.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $plainToken)
        $plainToken = $null

        foreach ($endpoint in @('/api/v1/contracts', '/api/v1/contracts/financial-details')) {
            $response = $null
            $rawBody = $null
            try {
                $response = $client.GetAsync('https://rimal-api.onrender.com' + $endpoint).GetAwaiter().GetResult()
                $rawBody = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
                $summary = Get-RatehawkContractCheckSummary -Endpoint $endpoint -StatusCode ([int]$response.StatusCode) -ResponseBody $rawBody -NoStore ([bool]$response.Headers.CacheControl.NoStore)
                Write-Output (ConvertTo-Json -InputObject $summary -Compress)
                if ($summary.result -eq 'unauthorized' -or $summary.result -eq 'booking_auth_not_configured') { break }
            } catch {
                Write-Output (ConvertTo-Json -Compress -InputObject ([ordered]@{ endpoint = $endpoint; result = 'request_failed' }))
            } finally {
                if ($null -ne $response) { $response.Dispose() }
                $rawBody = $null
            }
        }
    } catch {
        Write-Output 'Check failed. Confidential details withheld.'
    } finally {
        $plainToken = $null
        if ($null -ne $client) {
            $client.DefaultRequestHeaders.Clear()
            $client.Dispose()
        }
        if ($null -ne $handler) { $handler.Dispose() }
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    $secureToken = $null
    try {
        Write-Host 'READ-ONLY CHECK: use the SAME token already saved in Render. No bookings or payments.'
        $secureToken = Read-Host 'Paste RATEHAWK_BOOKING_TOKEN here, then press Enter (input is hidden)' -AsSecureString
        Invoke-RatehawkContractsCheck -Token $secureToken
    } finally {
        if ($null -ne $secureToken) { $secureToken.Dispose() }
    }
}