'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

function getOrCreateCid() {
    let cid = localStorage.getItem('guest_cid')
    if (cid) return cid

    cid = crypto.randomUUID() + '_' + Date.now()
    localStorage.setItem('guest_cid', cid)
    return cid
}

export default function LoginPage() {
    const router = useRouter()
    const [token, setToken] = useState('wdn66808')
    const [msg, setMsg] = useState('')

    async function login() {
        if (!token.trim()) {
            setMsg('请输入授权码')
            return
        }

        try {
            const rsp = await fetch('/api/proxy/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    token,
                    cid: getOrCreateCid(),
                }),
            })

            if (!rsp.ok) {
                setMsg(await rsp.text())
                return
            }

            const data = await rsp.json()
            console.log(data)

            if (data.jwt_token) {
                localStorage.setItem('raw_token', token)
                localStorage.setItem('jwt_token', data.jwt_token)
                setMsg('登录成功')
                router.replace('/dashboard')
            } else {
                setMsg('登录失败')
            }
        } catch (e) {
            console.log(e)
            setMsg('请求异常')
        }
    }

    return (
        <div className="p-10">
            <input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="请输入授权码"
                className="border px-3 py-2"
            />
            <button onClick={login} className="ml-3 rounded bg-blue-500 px-4 py-2 text-white">
                登录
            </button>
            <p className="mt-4">{msg}</p>
        </div>
    )
}