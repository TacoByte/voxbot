import { useState } from 'preact/hooks'
import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import { isMobile } from '../../../common/helpers/detector'
import { hasMetamask } from '../auth/login-helper'
import { login } from '../auth/state-login'
import { app } from '../state'

async function checkNameAvailable(name: string): Promise<boolean> {
  const r = await fetch('/api/account/reserve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  const j = await r.json()
  return !!j.available
}

const fetchParams = {
  headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
} as const

async function postJSON(url: string, body: unknown) {
  const f = await fetch(url, { ...fetchParams, method: 'POST', body: JSON.stringify(body), credentials: 'include' })
  let data: any
  try {
    data = await f.json()
  } catch {
    throw new Error('Bad response from server')
  }
  if (!f.ok) {
    const msg = typeof data?.error === 'string' ? data.error : typeof data?.message === 'string' ? data.message : `Request failed (${f.status})`
    throw new Error(msg)
  }
  return data
}

enum Status {
  Initial,
  Sending,
  Sent,
  Submitting,
}

export const Login = ({ reason }: { reason?: string }) => {
  const [status, setStatus] = useState(Status.Initial)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [passkeyUsername, setPasskeyUsername] = useState('')
  const [passkeyError, setPasskeyError] = useState('')
  const [passkeyBusy, setPasskeyBusy] = useState(false)
  const [passkeyPhase, setPasskeyPhase] = useState<null | 'login' | 'register'>(null)
  const [pendingToken, setPendingToken] = useState<string | null>(null)
  const [chosenName, setChosenName] = useState('')
  const [nameAvailable, setNameAvailable] = useState<boolean | null>(null)
  const [nameChecking, setNameChecking] = useState(false)

  const finishPasskeySession = (r: { success: boolean; token?: string; name?: string | null; isNewUser?: boolean; error?: string }) => {
    if (!r.success) {
      setPasskeyError(r.error || 'Something went wrong')
      return
    }
    if (!r.token) {
      setPasskeyError('No session token from server')
      return
    }
    login.onToken(r.token, r.name ?? null, !!r.isNewUser)
    if (!app.signedIn) {
      setPasskeyError('Could not start your session. Try again or use email or wallet.')
    }
  }

  const onPasskeyRegister = async () => {
    if (!passkeyUsername.trim() || passkeyBusy) return
    setPasskeyBusy(true)
    setPasskeyPhase('register')
    setPasskeyError('')
    try {
      const opts = await postJSON('/api/passkey/register/options', { username: passkeyUsername })
      if (!opts.success) {
        setPasskeyError(opts.error || 'Failed')
        return
      }
      const attResp = await startRegistration({ optionsJSON: opts.options })
      const r = await postJSON('/api/passkey/register/verify', { username: passkeyUsername, attResp })
      finishPasskeySession(r)
    } catch (e: any) {
      setPasskeyError(e?.message || 'Cancelled')
    } finally {
      setPasskeyBusy(false)
      setPasskeyPhase(null)
    }
  }

  const onPasskeyLogin = async () => {
    if (!passkeyUsername.trim() || passkeyBusy) return
    setPasskeyBusy(true)
    setPasskeyPhase('login')
    setPasskeyError('')
    try {
      const opts = await postJSON('/api/passkey/login/options', { username: passkeyUsername })
      if (!opts.success) {
        setPasskeyError(opts.error || 'Failed')
        return
      }
      const authResp = await startAuthentication({ optionsJSON: opts.options })
      const r = await postJSON('/api/passkey/login/verify', { username: passkeyUsername, authResp })
      finishPasskeySession(r)
    } catch (e: any) {
      setPasskeyError(e?.message || 'Cancelled')
    } finally {
      setPasskeyBusy(false)
      setPasskeyPhase(null)
    }
  }

  const pattern = '[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}$'

  const onClick = (e: Event) => {
    const canInstallMetamask = !isMobile() && !hasMetamask()
    if (canInstallMetamask) {
      window.open('https://chrome.google.com/webstore/detail/metamask/nkbihfbeogaeaoehlefnkodbefgpgknn', '_blank', 'noopener')
    } else {
      login.signin()
    }
  }

  const onSubmit = async (e: Event) => {
    e.preventDefault()

    if (status == Status.Sending) {
      return
    } else if (status == Status.Initial) {
      setStatus(Status.Sending)

      const body = JSON.stringify({ email })
      const f = await fetch('/api/signin/code', { ...fetchParams, method: 'POST', body })
      const j = await f.json()

      if (j.success) {
        setStatus(Status.Sent)
      } else {
        setStatus(Status.Initial)

        alert(j.message)
      }
    } else if (status == Status.Sent) {
      setStatus(Status.Submitting)

      const r = await app.emailSignin(email, code)
      if (!r) {
        setStatus(Status.Sent)
        return
      }
      if (r.isNewUser) {
        setPendingToken(r.token)
        setStatus(Status.Initial)
      } else {
        app.onToken(r.token, r.name, false)
      }
    }
  }

  const onNameInput = async (name: string) => {
    setChosenName(name)
    setNameAvailable(null)
    if (!name.trim()) return
    setNameChecking(true)
    const avail = await checkNameAvailable(name.trim())
    setNameChecking(false)
    setNameAvailable(avail)
  }

  const onConfirmName = async (e: Event) => {
    e.preventDefault()
    if (!pendingToken || !chosenName.trim() || !nameAvailable) return
    app.onToken(pendingToken, chosenName.trim(), true)
    await fetch('/api/avatar', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: chosenName.trim() }),
    }).catch(() => {})
  }

  const onReset = (e: Event) => {
    setStatus(Status.Initial)
    e.preventDefault()
  }

  if (pendingToken) {
    return (
      <section class="login">
        <h1>choose a name</h1>
        <form onSubmit={onConfirmName}>
          <div class="f">
            <label>name</label>
            <input type="text" autofocus value={chosenName} onInput={(e) => onNameInput(e.currentTarget.value)} placeholder="yourname" autocapitalize="none" />
          </div>
          {chosenName.trim() && <p>{nameChecking ? 'checking...' : nameAvailable === true ? 'available' : nameAvailable === false ? 'taken' : ''}</p>}
          <button type="submit" disabled={!nameAvailable || !chosenName.trim()}>
            create account
          </button>
        </form>
      </section>
    )
  }

  return (
    <section class="login">
      <h1>Log in{reason ? ` to ${reason}` : ''}</h1>
      <div class="login-form">
        <div class="login-block">
          <h1>Wallet</h1>
          <button type="button" onClick={onClick}>
            <img src={'/images/metamask.png'} width={30} height={30} title={'Metamask'} alt="" />
            &nbsp;Metamask
          </button>
        </div>

        <hr class="login-form-divider" />

        <div class="login-block">
          <h1>Email / Passkey</h1>
          <form onSubmit={onSubmit}>
            <fieldset>
              <label>
                Username or email
                <input
                  value={email || passkeyUsername}
                  onInput={(e) => {
                    const v = e.currentTarget.value
                    setEmail(v)
                    setPasskeyUsername(v)
                  }}
                  type="text"
                  autocomplete="username email"
                  autocapitalize="none"
                  placeholder="username or email@example.com"
                />
              </label>
            </fieldset>

            {(status == Status.Sent || status == Status.Submitting) && (
              <fieldset>
                <label>
                  Code
                  <input maxLength={6} autofocus onInput={(e: any) => setCode(e.target.value)} type="text" />
                </label>
              </fieldset>
            )}

            {passkeyError ? <p class="login-error">{passkeyError}</p> : null}

            <div class="login-passkey-actions">
              {status == Status.Sent || status == Status.Submitting ? (
                <>
                  {status == Status.Submitting ? <button disabled>Submitting...</button> : <button>Log in</button>}
                  <a href="" role="button" onClick={onReset}>
                    cancel
                  </a>
                </>
              ) : passkeyBusy ? (
                <button type="button" disabled>
                  {passkeyPhase === 'register' ? 'Creating account...' : 'Logging in...'}
                </button>
              ) : (
                <>
                  {status == Status.Sending ? <button disabled>Submitting...</button> : <button type="submit">Continue</button>}
                  <button type="button" onClick={onPasskeyLogin} disabled={!passkeyUsername.trim()}>
                    Log in with passkey
                  </button>
                  <button type="button" onClick={onPasskeyRegister} disabled={!passkeyUsername.trim()}>
                    Create account
                  </button>
                </>
              )}
            </div>
          </form>
        </div>
      </div>
    </section>
  )
}
